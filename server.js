const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// ТВОИ КЛЮЧИ (ССЫЛКА И СЕКРЕТНЫЙ КЛЮЧ)
// ==========================================
const SUPABASE_URL = 'https://jmbnfxlnrdapcblipcqx.supabase.co'; 
const SUPABASE_KEY = 'sb_secret_S91iy3ikiOPpsibP7VLQTA_dyxCb_Gd'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 1. РЕГИСТРАЦИЯ
app.post('/api/register', async (req, res) => {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });

    const { data: existingUser } = await supabase.from('users').select('*').eq('login', login).single();
    if (existingUser) return res.status(400).json({ error: 'Логин уже занят' });

    const { data, error } = await supabase.from('users').insert([{ login, password, balance: 30 }]).select().single();
    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, user: data });
});

// 2. ВХОД
app.post('/api/login', async (req, res) => {
    const { login, password } = req.body;
    const { data: user, error } = await supabase.from('users').select('*').eq('login', login).eq('password', password).single();
    
    if (error || !user) return res.status(400).json({ error: 'Неверный логин или пароль' });
    res.json({ success: true, user });
});

// 3. ПОЛУЧИТЬ ДАННЫЕ ИГРОКА
app.get('/api/user/:login', async (req, res) => {
    const { data: user, error } = await supabase.from('users').select('*').eq('login', req.params.login).single();
    if (error || !user) return res.status(404).json({ error: 'Юзер не найден' });

    const { data: inventory } = await supabase.from('inventory').select('*').eq('user_login', req.params.login);
    res.json({ balance: user.balance, inventory: inventory || [] });
});

// 4. ВЫИГРЫШ: Добавить предмет
app.post('/api/inventory/add', async (req, res) => {
    const { login, itemId, name, icon, rarity, price } = req.body;
    const uid = Date.now() + '_' + Math.random().toString(36).slice(2);
    const { error } = await supabase.from('inventory').insert([{ 
        uid, user_login: login, item_id: itemId, name, icon, rarity, price, status: 'inventory' 
    }]);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// 5. ПРОДАТЬ ПРЕДМЕТ
app.post('/api/inventory/sell', async (req, res) => {
    const { login, uid, price } = req.body;
    await supabase.from('inventory').delete().eq('user_login', login).eq('uid', uid);
    const { data: user } = await supabase.from('users').select('balance').eq('login', login).single();
    await supabase.from('users').update({ balance: user.balance + price }).eq('login', login);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
