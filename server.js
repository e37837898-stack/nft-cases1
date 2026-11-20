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

// === АВТОРИЗАЦИЯ ===
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

// === КЕЙСЫ ===
app.post('/api/inventory/add', async (req, res) => {
    const { login, casePrice, itemId, name, icon, rarity, price } = req.body;
    const cost = Number(casePrice) || 0;
    if (!login || cost <= 0) return res.status(400).json({ error: 'Некорректные данные' });

    const { data: newBalance, error: balError } = await supabase.rpc('spend_balance', {
        p_login: login,
        p_amount: cost
    });

    if (balError) {
        console.error('Ошибка RPC spend_balance:', balError);
        return res.status(500).json({ error: balError.message });
    }
    if (newBalance === null) return res.status(400).json({ error: 'Недостаточно звёзд!' });

    const uid = Date.now() + '_' + Math.random().toString(36).slice(2);
    const { error } = await supabase.from('inventory').insert([{ 
        uid, user_login: login, item_id: itemId, name, icon, rarity, price, status: 'inventory' 
    }]);
    
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, balance: newBalance });
});

// === ПРОДАЖА ПРЕДМЕТА ===
app.post('/api/inventory/sell', async (req, res) => {
    const { login, uid } = req.body;
    if (!login || !uid) return res.status(400).json({ error: 'Некорректные данные' });

    const { data: deletedItems, error: delError } = await supabase
        .from('inventory').delete().eq('user_login', login).eq('uid', uid).select();

    if (delError) return res.status(500).json({ error: delError.message });
    if (!deletedItems || deletedItems.length === 0) return res.status(410).json({ error: 'Предмет уже продан' });

    const realPrice = Number(deletedItems[0].price) || 0;
    const { data: user } = await supabase.from('users').select('balance').eq('login', login).single();
    if (!user) return res.status(404).json({ error: 'Юзер не найден' });

    const { data: updatedUser, error: balErr } = await supabase
        .from('users').update({ balance: user.balance + realPrice }).eq('login', login).select().single();

    if (balErr || !updatedUser) return res.status(500).json({ error: 'Ошибка начисления' });
    res.json({ success: true, balance: updatedUser.balance });
});

// === АДМИНКА: ПОЛУЧЕНИЕ СПИСКА ИГРОКОВ ===
app.get('/api/admin/players', async (req, res) => {
    const { data: users, error } = await supabase.from('users').select('login, balance, is_admin, is_super_admin');
    if (error) return res.status(500).json({ error: error.message });
    
    const { data: inventory } = await supabase.from('inventory').select('user_login');
    
    const players = users.map(u => {
        const invCount = inventory ? inventory.filter(i => i.user_login === u.login).length : 0;
        return { ...u, nft_count: invCount };
    });
    res.json(players);
});

// === АДМИНКА: ЗВЕЗДЫ ===
app.post('/api/admin/give-stars', async (req, res) => {
    const { adminLogin, targetLogin, amount } = req.body;
    const { data: admin } = await supabase.from('users').select('is_admin').eq('login', adminLogin).single();
    if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Доступ запрещен' });
    
    const { data: user } = await supabase.from('users').select('balance').eq('login', targetLogin).single();
    if (!user) return res.status(404).json({ error: 'Игрок не найден' });

    const { data: updatedUser } = await supabase.from('users')
        .update({ balance: user.balance + Number(amount) }).eq('login', targetLogin).select().single();
    res.json({ success: true, balance: updatedUser.balance });
});

app.post('/api/admin/take-stars', async (req, res) => {
    const { adminLogin, targetLogin, amount } = req.body;
    const { data: admin } = await supabase.from('users').select('is_admin').eq('login', adminLogin).single();
    if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Доступ запрещен' });
    
    const { data: user } = await supabase.from('users').select('balance').eq('login', targetLogin).single();
    if (!user) return res.status(404).json({ error: 'Игрок не найден' });

    const newBalance = Math.max(0, user.balance - Number(amount));
    const { data: updatedUser } = await supabase.from('users')
        .update({ balance: newBalance }).eq('login', targetLogin).select().single();
    res.json({ success: true, balance: updatedUser.balance });
});

// === АДМИНКА: NFT ===
app.post('/api/admin/give-nft', async (req, res) => {
    const { adminLogin, targetLogin, itemId, name, icon, rarity, price } = req.body;
    const { data: admin } = await supabase.from('users').select('is_admin').eq('login', adminLogin).single();
    if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Доступ запрещен' });
    
    const uid = Date.now() + '_' + Math.random().toString(36).slice(2);
    const { error } = await supabase.from('inventory').insert([{
        uid, user_login: targetLogin, item_id: itemId, name, icon, rarity, price, status: 'inventory'
    }]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

app.post('/api/admin/take-nft', async (req, res) => {
    const { adminLogin, targetLogin, uid } = req.body;
    const { data: admin } = await supabase.from('users').select('is_admin').eq('login', adminLogin).single();
    if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Доступ запрещен' });
    
    const { data: deleted } = await supabase.from('inventory').delete().eq('user_login', targetLogin).eq('uid', uid).select();
    if (!deleted || deleted.length === 0) return res.status(404).json({ error: 'NFT не найден' });
    res.json({ success: true });
});

// === АДМИНКА: ПРОМОКОДЫ ===
app.post('/api/admin/create-promo', async (req, res) => {
    const { adminLogin, code, stars, limit } = req.body;
    const { data: admin } = await supabase.from('users').select('is_admin').eq('login', adminLogin).single();
    if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Доступ запрещен' });
    
    const { data: existing } = await supabase.from('promocodes').select('*').eq('code', code.toUpperCase()).single();
    if (existing) return res.status(400).json({ error: 'Такой промокод уже существует' });

    const { error } = await supabase.from('promocodes').insert([{ 
        code: code.toUpperCase(), stars: Number(stars), max_uses: Number(limit), uses: 0 
    }]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// === АДМИНКА: ПРАВА ===
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
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
