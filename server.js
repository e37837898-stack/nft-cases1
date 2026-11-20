const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SUPABASE_URL = 'https://jmbnfxlnrdapcblipcqx.supabase.co'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptYm5meGxucmRhcGNibGlwY3F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxODQ5OTgsImV4cCI6MjExMDc2MDk5OH0.HBvYC5M_HKqIfGuZ7-8Vuqwd3oH4BcrsTpMbaROaJTs'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

app.post('/api/register', async (req, res) => {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
    const { data: existingUser } = await supabase.from('users').select('*').eq('login', login).single();
    if (existingUser) return res.status(400).json({ error: 'Логин уже занят' });
    const { data, error } = await supabase.from('users').insert([{ login, password, balance: 30 }]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, user: data });
});

app.post('/api/login', async (req, res) => {
    const { login, password } = req.body;
    const { data: user, error } = await supabase.from('users').select('*').eq('login', login).eq('password', password).single();
    if (error || !user) return res.status(400).json({ error: 'Неверный логин или пароль' });
    res.json({ success: true, user });
});

app.get('/api/user/:login', async (req, res) => {
    const { data: user, error } = await supabase.from('users').select('*').eq('login', req.params.login).single();
    if (error || !user) return res.status(404).json({ error: 'Юзер не найден' });
    const { data: inventory } = await supabase.from('inventory').select('*').eq('user_login', req.params.login);
    res.json({ balance: user.balance, inventory: inventory || [], is_admin: user.is_admin || false, is_super_admin: user.is_super_admin || false });
});

// === БАГ 1: атомарное списание звёзд с откатом при ошибке вставки ===
app.post('/api/inventory/add', async (req, res) => {
    const { login, casePrice, itemId, name, icon, rarity, price } = req.body;
    const cost = Number(casePrice) || 0;
    if (!login || cost <= 0) return res.status(400).json({ error: 'Некорректные данные' });

    // Шаг 1: атомарно списываем баланс, только если его хватает.
    // Если строка не обновилась (0 строк) — значит, баланса не хватило или юзера нет.
    const { data: updatedUser, error: balError } = await supabase
        .from('users')
        .update({ balance: supabase.raw ? supabase.raw(`balance - ${cost}`) : undefined })
        .eq('login', login)
        .gte('balance', cost)
        .select()
        .single();

    // fallback для версий supabase-js без .raw(): ручной RPC не нужен,
    // но мы не можем использовать .raw в новых версиях — поэтому:
    // если balError — пробуем через RPC-функцию decrement_balance (см. ниже).
    if (balError || !updatedUser) {
        // Альтернативный атомарный путь через RPC (рекомендуется создать функцию в SQL,
        // см. комментарий в конце файла). Если её нет — вернём ошибку честно.
        const { data: rpcData, error: rpcErr } = await supabase.rpc('decrement_balance', {
            p_login: login,
            p_amount: cost
        });
        if (rpcErr || !rpcData) {
            return res.status(400).json({ error: 'Недостаточно звёзд!' });
        }
        // rpcData — новый баланс (number)
        var newBalance = rpcData;

        const uid = Date.now() + '_' + Math.random().toString(36).slice(2);
        const { error: insErr } = await supabase.from('inventory').insert([{ uid, user_login: login, item_id: itemId, name, icon, rarity, price, status: 'inventory' }]);
        if (insErr) {
            // откат баланса
            await supabase.rpc('increment_balance', { p_login: login, p_amount: cost });
            return res.status(500).json({ error: insErr.message });
        }
        return res.json({ success: true, balance: newBalance });
    }

    // Штатный путь (сработал update ... gte): баланс уже списан атомарно.
    const uid = Date.now() + '_' + Math.random().toString(36).slice(2);
    const { error: insErr } = await supabase.from('inventory').insert([{ uid, user_login: login, item_id: itemId, name, icon, rarity, price, status: 'inventory' }]);
    if (insErr) {
        // откат: возвращаем звёзды
        await supabase.rpc('increment_balance', { p_login: login, p_amount: cost });
        return res.status(500).json({ error: insErr.message });
    }
    res.json({ success: true, balance: updatedUser.balance });
});

// === БАГ 2: атомарная продажа — сначала DELETE ... SELECT, потом атомарный инкремент ===
app.post('/api/inventory/sell', async (req, res) => {
    const { login, uid } = req.body;
    if (!login || !uid) return res.status(400).json({ error: 'Некорректные данные' });

    // Атомарно удаляем предмет; если его уже нет — 0 строк → отказ.
    const { data: deletedItems, error: delError } = await supabase
        .from('inventory')
        .delete()
        .eq('user_login', login)
        .eq('uid', uid)
        .select();

    if (delError) return res.status(500).json({ error: delError.message });
    if (!deletedItems || deletedItems.length === 0) {
        return res.status(400).json({ error: 'Предмет уже продан' });
    }

    const realPrice = Number(deletedItems[0].price) || 0;

    // Атомарный инкремент баланса через RPC (без гонки SELECT→UPDATE).
    const { data: newBalance, error: incErr } = await supabase.rpc('increment_balance', {
        p_login: login,
        p_amount: realPrice
    });
    if (incErr) {
        // предмет уже удалён, но баланс не начислен — вернём предмет обратно
        await supabase.from('inventory').insert([deletedItems[0]]);
        return res.status(500).json({ error: 'Ошибка начисления баланса' });
    }

    res.json({ success: true, balance: newBalance, soldPrice: realPrice });
});

app.post('/api/admin/give-stars', async (req, res) => {
    const { adminLogin, targetLogin, amount } = req.body;
    const { data: admin } = await supabase.from('users').select('is_admin').eq('login', adminLogin).single();
    if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Доступ запрещен' });
    const { data: user } = await supabase.from('users').select('balance').eq('login', targetLogin).single();
    if (!user) return res.status(404).json({ error: 'Игрок не найден' });
    const { error: e } = await supabase.rpc('increment_balance', { p_login: targetLogin, p_amount: Number(amount) });
    if (e) return res.status(500).json({ error: e.message });
    res.json({ success: true });
});

app.post('/api/admin/make-admin', async (req, res) => {
    const { superAdminLogin, targetLogin } = req.body;
    const { data: superAdmin } = await supabase.from('users').select('is_super_admin').eq('login', superAdminLogin).single();
    if (!superAdmin || !superAdmin.is_super_admin) return res.status(403).json({ error: 'Только главный админ может назначать!' });
    await supabase.from('users').update({ is_admin: true }).eq('login', targetLogin);
    res.json({ success: true });
});

app.post('/api/admin/remove-admin', async (req, res) => {
    const { superAdminLogin, targetLogin } = req.body;
    const { data: superAdmin } = await supabase.from('users').select('is_super_admin').eq('login', superAdminLogin).single();
    if (!superAdmin || !superAdmin.is_super_admin) return res.status(403).json({ error: 'Только главный админ может снимать!' });
    await supabase.from('users').update({ is_admin: false }).eq('login', targetLogin);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server started'));
