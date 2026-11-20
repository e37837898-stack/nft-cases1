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
    const totalItems = inventory ? inventory.length : 0;
    const totalValue = inventory ? inventory.reduce((sum, item) => sum + (Number(item.price) || 0), 0) : 0;
    res.json({ balance: user.balance, inventory: inventory || [], is_admin: user.is_admin || false, is_super_admin: user.is_super_admin || false, stats: { totalItems, totalValue } });
});

const CASE_POOLS = {
    'starter': [
        { id: 'bear', name: 'Мишка', icon: '🧸', rarity: 'common', price: 15, chance: 25 },
        { id: 'gift', name: 'Подарок', icon: '🎁', rarity: 'common', price: 25, chance: 20 },
        { id: 'heart', name: 'Сердечко', icon: '💖', rarity: 'common', price: 15, chance: 25 },
        { id: 'rose', name: 'Роза', icon: '🌹', rarity: 'common', price: 25, chance: 20 },
        { id: 'skull', name: 'Череп', icon: '💀', rarity: 'nft', price: 50, chance: 10 }
    ],
    'pro': [
        { id: 'cake', name: 'Торт', icon: '🎂', rarity: 'common', price: 50, chance: 40 },
        { id: 'bouquet', name: 'Букет', icon: '💐', rarity: 'common', price: 50, chance: 30 },
        { id: 'rocket', name: 'Ракета', icon: '🚀', rarity: 'common', price: 50, chance: 15 },
        { id: 'cigarette', name: 'Сигарета', icon: '🚬', rarity: 'rare', price: 500, chance: 10 },
        { id: 'socks', name: 'Носки', icon: '🧦', rarity: 'rare', price: 1000, chance: 5 }
    ],
    'elite': [
        { id: 'cup', name: 'Кубок', icon: '🏆', rarity: 'common', price: 100, chance: 30 },
        { id: 'ring', name: 'Кольцо', icon: '💍', rarity: 'common', price: 100, chance: 30 },
        { id: 'calendar', name: 'Календарь', icon: '📅', rarity: 'rare', price: 1500, chance: 20 },
        { id: 'car', name: 'Машина', icon: '🚗', rarity: 'legendary', price: 5000, chance: 15 },
        { id: 'pepe', name: 'Плюш Пепе', icon: '🐸', rarity: 'legendary', price: 50000, chance: 5 }
    ]
};
const CASE_PRICES = { 'starter': 50, 'pro': 500, 'elite': 8000 };

app.post('/api/cases/open', async (req, res) => {
    const { login, caseId } = req.body;
    const price = CASE_PRICES[caseId];
    if (!price) return res.status(400).json({ error: 'Неизвестный кейс' });
    const { data: newBalance, error: balError } = await supabase.rpc('spend_balance', { p_login: login, p_amount: price });
    if (balError) return res.status(500).json({ error: balError.message });
    if (newBalance === null) return res.status(400).json({ error: 'Недостаточно звёзд!' });

    const pool = CASE_POOLS[caseId];
    let random = Math.random() * pool.reduce((sum, item) => sum + item.chance, 0);
    let droppedItem = pool[0];
    for (let item of pool) {
        if (random < item.chance) { droppedItem = item; break; }
        random -= item.chance;
    }

    const uid = Date.now() + '_' + Math.random().toString(36).slice(2);
    await supabase.from('inventory').insert([{ uid, user_login: login, item_id: droppedItem.id, name: droppedItem.name, icon: droppedItem.icon, rarity: droppedItem.rarity, price: droppedItem.price, status: 'inventory' }]);
    
    droppedItem.uid = uid; // Передаем UID клиенту для продажи
    res.json({ success: true, balance: newBalance, item: droppedItem, pool: pool });
});

app.post('/api/inventory/sell', async (req, res) => {
    const { login, uid } = req.body;
    const { data: deletedItems } = await supabase.from('inventory').delete().eq('user_login', login).eq('uid', uid).select();
    if (!deletedItems || deletedItems.length === 0) return res.status(410).json({ error: 'Уже продано' });
    const realPrice = Number(deletedItems[0].price) || 0;
    const { data: user } = await supabase.from('users').select('balance').eq('login', login).single();
    const { data: updatedUser } = await supabase.from('users').update({ balance: user.balance + realPrice }).eq('login', login).select().single();
    res.json({ success: true, balance: updatedUser.balance });
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

app.post('/api/upgrade', async (req, res) => {
    const { login, myUid, targetItemId } = req.body;
    const { data: myItem } = await supabase.from('inventory').select('*').eq('user_login', login).eq('uid', myUid).single();
    if (!myItem) return res.status(404).json({ error: 'Ваш предмет не найден' });
    
    const targetPool = CASE_POOLS['elite'];
    const targetItem = targetPool.find(i => i.id === targetItemId);
    if (!targetItem) return res.status(400).json({ error: 'Целевой предмет не найден' });

    await supabase.from('inventory').delete().eq('uid', myUid);
    const isWin = Math.random() < 0.5;
    
    if (isWin) {
        const newUid = Date.now() + '_' + Math.random().toString(36).slice(2);
        await supabase.from('inventory').insert([{ uid: newUid, user_login: login, item_id: targetItem.id, name: targetItem.name, icon: targetItem.icon, rarity: targetItem.rarity, price: targetItem.price, status: 'inventory' }]);
        res.json({ success: true, win: true, item: targetItem });
    } else {
        res.json({ success: true, win: false, item: myItem });
    }
});

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

app.get('/api/admin/players', async (req, res) => {
    const { data: users } = await supabase.from('users').select('login, balance, is_admin, is_super_admin');
    const { data: inventory } = await supabase.from('inventory').select('user_login');
    const players = users.map(u => ({ ...u, nft_count: inventory ? inventory.filter(i => i.user_login === u.login).length : 0 }));
    res.json(players);
});
app.get('/api/admin/withdraws', async (req, res) => { const { data } = await supabase.from('withdraw_requests').select('*').eq('status', 'pending'); res.json(data || []); });
app.post('/api/admin/withdraws/accept', async (req, res) => {
    const { id } = req.body;
    const { data: reqItem } = await supabase.from('withdraw_requests').select('*').eq('id', id).single();
    if (!reqItem) return res.status(404).json({ error: 'Нет заявки' });
    const { data: user } = await supabase.from('users').select('balance').eq('login', reqItem.user_login).single();
    await supabase.from('users').update({ balance: user.balance + reqItem.item_price }).eq('login', reqItem.user_login);
    await supabase.from('withdraw_requests').delete().eq('id', id);
    res.json({ success: true });
});
app.post('/api/admin/give-stars', async (req, res) => {
    const { adminLogin, targetLogin, amount } = req.body;
    const { data: admin } = await supabase.from('users').select('is_admin').eq('login', adminLogin).single();
    if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Нет доступа' });
    const { data: user } = await supabase.from('users').select('balance').eq('login', targetLogin).single();
    await supabase.from('users').update({ balance: user.balance + Number(amount) }).eq('login', targetLogin);
    res.json({ success: true });
});
app.post('/api/admin/take-stars', async (req, res) => {
    const { adminLogin, targetLogin, amount } = req.body;
    const { data: admin } = await supabase.from('users').select('is_admin').eq('login', adminLogin).single();
    if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Нет доступа' });
    const { data: user } = await supabase.from('users').select('balance').eq('login', targetLogin).single();
    await supabase.from('users').update({ balance: Math.max(0, user.balance - Number(amount)) }).eq('login', targetLogin);
    res.json({ success: true });
});
app.post('/api/admin/create-promo', async (req, res) => {
    const { adminLogin, code, stars, limit } = req.body;
    const { data: admin } = await supabase.from('users').select('is_admin').eq('login', adminLogin).single();
    if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Нет доступа' });
    const { data: existing } = await supabase.from('promocodes').select('*').eq('code', code.toUpperCase()).single();
    if (existing) return res.status(400).json({ error: 'Код уже есть' });
    await supabase.from('promocodes').insert([{ code: code.toUpperCase(), stars: Number(stars), max_uses: Number(limit), uses: 0 }]);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
