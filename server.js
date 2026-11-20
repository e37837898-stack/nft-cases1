const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Указываем серверу, где искать файлы сайта (папка public)
app.use(express.static(path.join(__dirname, 'public')));

// ТВОИ КЛЮЧИ
const SUPABASE_URL = 'https://jmbnfxlnrdapcblipcqx.supabase.co'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptYm5meGxucmRhcGNibGlwY3F4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxODQ5OTgsImV4cCI6MjExMDc2MDk5OH0.HBvYC5M_HKqIfGuZ7-8Vuqwd3oH4BcrsTpMbaROaJTs'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ... (Остальной код API)
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

app.post('/api/inventory/add', async (req, res) => {
    const { login, itemId, name, icon, rarity, price } = req.body;
    const uid = Date.now() + '_' + Math.random().toString(36).slice(2);
    const { error } = await supabase.from('inventory').insert([{ uid, user_login: login, item_id: itemId, name, icon, rarity, price, status: 'inventory' }]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

app.post('/api/inventory/sell', async (req, res) => {
    const { login, uid, price } = req.body;
    await supabase.from('inventory').delete().eq('user_login', login).eq('uid', uid);
    const { data: user } = await supabase.from('users').select('balance').eq('login', login).single();
    await supabase.from('users').update({ balance: user.balance + price }).eq('login', login);
    res.json({ success: true });
});

app.post('/api/admin/give-stars', async (req, res) => {
    const { adminLogin, targetLogin, amount } = req.body;
    const { data: admin } = await supabase.from('users').select('is_admin').eq('login', adminLogin).single();
    if (!admin || !admin.is_admin) return res.status(403).json({ error: 'Доступ запрещен' });
    const { data: user } = await supabase.from('users').select('balance').eq('login', targetLogin).single();
    if (!user) return res.status(404).json({ error: 'Игрок не найден' });
    await supabase.from('users').update({ balance: user.balance + amount }).eq('login', targetLogin);
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

// ЗАПУСК
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('Сервер запущен на порту ' + PORT);
});
