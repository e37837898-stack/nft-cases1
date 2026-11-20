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

// Вспомогательная функция для логов
async function logAction(admin, action, details) {
    await supabase.from('admin_logs').insert([{ admin_login: admin, action, details }]);
}

// ==========================================
// БАЗА
// ==========================================
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
    const totalItems = inventory ? inventory.length : 0;
    const totalValue = inventory ? inventory.reduce((sum, item) => sum + (Number(item.price) || 0), 0) : 0;
    res.json({ balance: user.balance, inventory: inventory || [], is_admin: user.is_admin || false, is_super_admin: user.is_super_admin || false, stats: { totalItems, totalValue } });
});

// ==========================================
// КЕЙСЫ (ИЗ БАЗЫ)
// ==========================================
app.get('/api/cases', async (req, res) => {
    const { data } = await supabase.from('cases').select('*');
    res.json(data || []);
});

app.post('/api/cases/open', async (req, res) => {
    const { login, caseId } = req.body;
    
    // Получаем кейс из базы
    const { data: box } = await supabase.from('cases').select('*').eq('id', caseId).single();
    if (!box) return res.status(400).json({ error: 'Кейс не найден' });
    
    const price = Number(box.price);
    const { data: newBalance, error: balError } = await supabase.rpc('spend_balance', { p_login: login, p_amount: price });
    if (balError) return res.status(500).json({ error: balError.message });
    if (newBalance === null) return res.status(400).json({ error: 'Недостаточно звёзд!' });

    const pool = box.items;
    let random = Math.random() * pool.reduce((sum, item) => sum + Number(item.chance), 0);
    let droppedItem = pool[0];
    for (let item of pool) {
        if (random < Number(item.chance)) { droppedItem = item; break; }
        random -= Number(item.chance);
    }

    const uid = Date.now() + '_' + Math.random().toString(36).slice(2);
    await supabase.from('inventory').insert([{ uid, user_login: login, item_id: droppedItem.id, name: droppedItem.name, icon: droppedItem.icon, rarity: droppedItem.rarity, price: droppedItem.price, status: 'inventory' }]);
    await supabase.from('drop_history').insert([{ user_login: login, item_name: droppedItem.name, item_icon: droppedItem.icon }]);
    
    droppedItem.uid = uid;
    res.json({ success: true, balance: newBalance, item: droppedItem, pool: pool });
});

app.get('/api/cases/drops', async (req, res) => {
    const { data } = await supabase.from('drop_history').select('*').order('created_at', { ascending: false }).limit(10);
    res.json(data || []);
});

// ==========================================
// ПРОДАЖА И ВЫВОД
// ==========================================
app.post('/api/inventory/sell', async (req, res) => {
    const { login, uid } = req.body;
    const { data: deletedItems } = await supabase.from('inventory').delete().eq('user_login', login).eq('uid', uid).select();
    if (!deletedItems || deletedItems.length === 0) return res.status(410).json({ error: 'Уже продано' });
    const realPrice = Number(deletedItems[0].price) || 0;
    const { data: user } = await supabase.from('users').select('balance').eq('login', login).single();
    const { data: updatedUser } = await supabase.from('users').update({ balance: user.balance + realPrice }).eq('login', login).select().single();
    res.json({ success: true, balance: updatedUser.balance });
});

app.post('/api/inventory/sell-junk', async (req, res) => {
    const { login } = req.body;
    const { data: inventory } = await supabase.from('inventory').select('*').eq('user_login', login);
    if (!inventory || inventory.length === 0) return res.status(400).json({ error: 'Инвентарь пуст' });
    
    // Фильтруем только предметы до 50 звезд
    const junkItems = inventory.filter(item => Number(item.price) <= 50);
    if (junkItems.length === 0) return res.status(400).json({ error: 'Нет мусора для продажи' });
    
    const totalPrice = junkItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    const uidsToDelete = junkItems.map(item => item.uid);
    
    await supabase.from('inventory').delete().in('uid', uidsToDelete);
    const { data: user } = await supabase.from('users').select('balance').eq('login', login).single();
    await supabase.from('users').update({ balance: user.balance + totalPrice }).eq('login', login);
    res.json({ success: true, earned: totalPrice, count: junkItems.length });
});

app.post('/api/inventory/sell-all', async (req, res) => {
    const { login } = req.body;
    const { data: inventory } = await supabase.from('inventory').select('*').eq('user_login', login);
    if (!inventory || inventory.length === 0) return res.status(400).json({ error: 'Инвентарь пуст' });
    const totalPrice = inventory.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    await supabase.from('inventory').delete().eq('user_login', login);
    const { data: user } = await supabase.from('users').select('balance').eq('login', login).single();
    await supabase.from('users').update({ balance: user.balance + totalPrice }).eq('login', login);
    res.json({ success: true, earned: totalPrice });
});

app.post('/api/inventory/withdraw', async (req, res) => {
    const { login, uid } = req.body;
    const { data: item } = await supabase.from('inventory').select('*').eq('user_login', login).eq('uid', uid).single();
    if (!item) return res.status(404).json({ error: 'Не найден' });
    await supabase.from('inventory').delete().eq('uid', uid);
    await supabase.from('withdraw_requests').insert([{ user_login: login, item_id: item.item_id, item_name: item.name, item_price: item.price }]);
    res.json({ success: true });
});

// ==========================================
// АПГРЕЙД
// ==========================================
app.post('/api/upgrade', async (req, res) => {
    const { login, myUid, targetItemId } = req.body;
    const { data: myItem } = await supabase.from('inventory').select('*').eq('user_login', login).eq('uid', myUid).single();
    if (!myItem) return res.status(404).json({ error: 'Ваш предмет не найден' });
    
    // Ищем целевой предмет во всех кейсах
    const { data: allCases } = await supabase.from('cases').select('items');
    let targetItem = null;
    for (const box of allCases) {
        targetItem = box.items.find(i => i.id === targetItemId);
        if (targetItem) break;
    }
    if (!targetItem) return res.status(400).json({ error: 'Целевой предмет не найден' });

    let winChance = (myItem.price / targetItem.price) * 50; 
    if (winChance > 50) winChance = 50;
    if (winChance < 1) winChance = 1;

    await supabase.from('inventory').delete().eq('uid', myUid);
    const isWin = Math.random() * 100 < winChance;
    
    if (isWin) {
        const newUid = Date.now() + '_' + Math.random().toString(36).slice(2);
        await supabase.from('inventory').insert([{ uid: newUid, user_login: login, item_id: targetItem.id, name: targetItem.name, icon: targetItem.icon, rarity: targetItem.rarity, price: targetItem.price, status: 'inventory' }]);
        res.json({ success: true, win: true, item: targetItem, chance: winChance });
    } else {
        res.json({ success: true, win: false, item: myItem, chance: winChance });
    }
});// ==========================================
// БОНУС
// ==========================================
app.post('/api/bonus/claim', async (req, res) => {
    const { login } = req.body;
    const { data: user } = await supabase.from('users').select('last_bonus, balance').eq('login', login).single();
    const now = new Date();
    if (user.last_bonus) {
        const last = new Date(user.last_bonus);
        const hours = (now - last) / (1000 * 60 * 60);
        if (hours < 24) return res.status(400).json({ error: 'Бонус будет доступен через ' + Math.ceil(24 - hours) + ' ч.' });
    }
    const { data: updatedUser } = await supabase.from('users').update({ balance: user.balance + 50, last_bonus: now.toISOString() }).eq('login', login).select().single();
    res.json({ success: true, balance: updatedUser.balance });
});

// ==========================================
// ПРОМОКОДЫ
// ==========================================
app.post('/api/promo/activate', async (req, res) => {
    const { login, code } = req.body;
    const { data: promo } = await supabase.from('promocodes').select('*').eq('code', code).single();
    if (!promo) return res.status(404).json({ error: 'Промокод не найден' });
    if (promo.uses >= promo.max_uses) return res.status(400).json({ error: 'Лимит исчерпан' });
    const { data: used } = await supabase.from('promo_history').select('*').eq('user_login', login).eq('code', code).single();
    if (used) return res.status(400).json({ error: 'Вы уже активировали' });
    const { data: user } = await supabase.from('users').select('balance').eq('login', login).single();
    await supabase.from('users').update({ balance: user.balance + promo.stars }).eq('login', login);
    await supabase.from('promo_history').insert([{ user_login: login, code: code }]);
    await supabase.from('promocodes').update({ uses: promo.uses + 1 }).eq('code', code);
    res.json({ success: true, stars: promo.stars });
});

// ==========================================
// ГЛОБАЛЬНЫЙ ЧАТ / НОВОСТИ
// ==========================================
app.get('/api/global-feed', async (req, res) => {
    const { data } = await supabase.from('global_feed').select('*').order('created_at', { ascending: false }).limit(20);
    res.json(data || []);
});

// ==========================================
// АДМИНКА (ПРОВЕРКА ПРАВ)
// ==========================================
// Функция проверки, является ли юзер админом
async function checkAdmin(login) {
    const { data } = await supabase.from('users').select('is_admin, is_super_admin').eq('login', login).single();
    return data || { is_admin: false, is_super_admin: false };
}

app.get('/api/admin/players', async (req, res) => {
    const { data: users } = await supabase.from('users').select('login, balance, is_admin, is_super_admin');
    const { data: inventory } = await supabase.from('inventory').select('user_login');
    const players = users.map(u => ({ ...u, nft_count: inventory ? inventory.filter(i => i.user_login === u.login).length : 0 }));
    res.json(players);
});

app.get('/api/admin/withdraws', async (req, res) => {
    const { data } = await supabase.from('withdraw_requests').select('*').eq('status', 'pending');
    res.json(data || []);
});

app.post('/api/admin/withdraws/accept', async (req, res) => {
    const { adminLogin, id } = req.body;
    const admin = await checkAdmin(adminLogin);
    if (!admin.is_super_admin) return res.status(403).json({ error: 'Только главный админ может подтверждать выводы' });
    
    const { data: reqItem } = await supabase.from('withdraw_requests').select('*').eq('id', id).single();
    if (!reqItem) return res.status(404).json({ error: 'Нет заявки' });
    const { data: user } = await supabase.from('users').select('balance').eq('login', reqItem.user_login).single();
    await supabase.from('users').update({ balance: user.balance + reqItem.item_price }).eq('login', reqItem.user_login);
    await supabase.from('withdraw_requests').delete().eq('id', id);
    await logAction(adminLogin, 'Вывод средств', `Одобрил вывод ${reqItem.item_name} для ${reqItem.user_login}`);
    res.json({ success: true });
});

app.post('/api/admin/give-stars', async (req, res) => {
    const { adminLogin, targetLogin, amount } = req.body;
    const admin = await checkAdmin(adminLogin);
    if (!admin.is_admin) return res.status(403).json({ error: 'Нет доступа' });
    
    const { data: user } = await supabase.from('users').select('balance').eq('login', targetLogin).single();
    if (!user) return res.status(404).json({ error: 'Игрок не найден' });
    await supabase.from('users').update({ balance: user.balance + Number(amount) }).eq('login', targetLogin);
    await logAction(adminLogin, 'Выдача звезд', `Выдал ${amount} 🌟 игроку ${targetLogin}`);
    res.json({ success: true });
});

app.post('/api/admin/take-stars', async (req, res) => {
    const { adminLogin, targetLogin, amount } = req.body;
    const admin = await checkAdmin(adminLogin);
    if (!admin.is_super_admin) return res.status(403).json({ error: 'Только главный админ может забирать звезды' });
    
    const { data: user } = await supabase.from('users').select('balance').eq('login', targetLogin).single();
    if (!user) return res.status(404).json({ error: 'Игрок не найден' });
    await supabase.from('users').update({ balance: Math.max(0, user.balance - Number(amount)) }).eq('login', targetLogin);
    await logAction(adminLogin, 'Списание звезд', `Забрал ${amount} 🌟 у игрока ${targetLogin}`);
    res.json({ success: true });
});

app.post('/api/admin/give-nft', async (req, res) => {
    const { adminLogin, targetLogin, item } = req.body;
    const admin = await checkAdmin(adminLogin);
    if (!admin.is_admin) return res.status(403).json({ error: 'Нет доступа' });
    
    const uid = Date.now() + '_' + Math.random().toString(36).slice(2);
    await supabase.from('inventory').insert([{ uid, user_login: targetLogin, item_id: item.id, name: item.name, icon: item.icon, rarity: item.rarity || 'common', price: item.price, status: 'inventory' }]);
    await logAction(adminLogin, 'Выдача NFT', `Выдал ${item.name} игроку ${targetLogin}`);
    res.json({ success: true });
});

app.post('/api/admin/create-promo', async (req, res) => {
    const { adminLogin, code, stars, limit } = req.body;
    const admin = await checkAdmin(adminLogin);
    if (!admin.is_super_admin) return res.status(403).json({ error: 'Только главный админ может создавать промокоды' });
    
    const { data: existing } = await supabase.from('promocodes').select('*').eq('code', code.toUpperCase()).single();
    if (existing) return res.status(400).json({ error: 'Код уже есть' });
    await supabase.from('promocodes').insert([{ code: code.toUpperCase(), stars: Number(stars), max_uses: Number(limit), uses: 0 }]);
    await logAction(adminLogin, 'Создание промокода', `Создал код ${code} на ${stars} звезд`);
    res.json({ success: true });
});

// --- НОВЫЕ ФУНКЦИИ АДМИНКИ ---

// Управление правами
app.post('/api/admin/make-admin', async (req, res) => {
    const { adminLogin, targetLogin } = req.body;
    const admin = await checkAdmin(adminLogin);
    if (!admin.is_super_admin) return res.status(403).json({ error: 'Только главный админ может назначать' });
    await supabase.from('users').update({ is_admin: true }).eq('login', targetLogin);
    await logAction(adminLogin, 'Права', `Назначил админом ${targetLogin}`);
    res.json({ success: true });
});

app.post('/api/admin/remove-admin', async (req, res) => {
    const { adminLogin, targetLogin } = req.body;
    const admin = await checkAdmin(adminLogin);
    if (!admin.is_super_admin) return res.status(403).json({ error: 'Только главный админ может снимать' });
    await supabase.from('users').update({ is_admin: false }).eq('login', targetLogin);
    await logAction(adminLogin, 'Права', `Снял права админа с ${targetLogin}`);
    res.json({ success: true });
});

// Логи
app.get('/api/admin/logs', async (req, res) => {
    const { data } = await supabase.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(50);
    res.json(data || []);
});

// Рассылка
app.post('/api/admin/broadcast', async (req, res) => {
    const { adminLogin, message } = req.body;
    const admin = await checkAdmin(adminLogin);
    if (!admin.is_super_admin) return res.status(403).json({ error: 'Только главный админ может делать рассылку' });
    await supabase.from('global_feed').insert([{ message }]);
    await logAction(adminLogin, 'Рассылка', `Отправил: ${message}`);
    res.json({ success: true });
});

// Создание/обновление кейсов
app.post('/api/admin/save-case', async (req, res) => {
    const { adminLogin, caseData } = req.body;
    const admin = await checkAdmin(adminLogin);
    if (!admin.is_super_admin) return res.status(403).json({ error: 'Только главный админ может менять кейсы' });
    
    const { error } = await supabase.from('cases').upsert([{ 
        id: caseData.id, name: caseData.name, icon: caseData.icon, price: Number(caseData.price), items: caseData.items 
    }]);
    if (error) return res.status(500).json({ error: error.message });
    
    await logAction(adminLogin, 'Кейсы', `Обновил кейс ${caseData.name}`);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
