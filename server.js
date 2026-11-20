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

async function logAction(admin, action, details) {
    await supabase.from('admin_logs').insert([{ admin_login: admin, action, details }]);
}

// ==========================================
// ХАРДКОД КЕЙСОВ (ЧТОБЫ НИКОГДА НЕ ПРОПАДАЛИ)
// ==========================================
const GAME_CASES = [
  { 
    id: 'starter', name: 'Стартовый', icon: '📦', price: 50, 
    items: [
      {id:'bear',name:'Мишка',icon:'🧸',rarity:'common',price:15,chance:25},
      {id:'gift',name:'Подарок',icon:'🎁',rarity:'common',price:25,chance:20},
      {id:'heart',name:'Сердечко',icon:'💖',rarity:'common',price:15,chance:25},
      {id:'rose',name:'Роза',icon:'🌹',rarity:'common',price:25,chance:20},
      {id:'skull',name:'Череп',icon:'💀',rarity:'nft',price:50,chance:10}
    ] 
  },
  { 
    id: 'pro', name: 'Про', icon: '🎁', price: 500, 
    items: [
      {id:'cake',name:'Торт',icon:'🎂',rarity:'common',price:50,chance:40},
      {id:'bouquet',name:'Букет',icon:'💐',rarity:'common',price:50,chance:30},
      {id:'rocket',name:'Ракета',icon:'🚀',rarity:'common',price:50,chance:15},
      {id:'cigarette',name:'Сигарета',icon:'🚬',rarity:'rare',price:500,chance:10},
      {id:'socks',name:'Носки',icon:'🧦',rarity:'rare',price:1000,chance:5}
    ] 
  },
  { 
    id: 'elite', name: 'Элитный', icon: '💎', price: 8000, 
    items: [
      {id:'cup',name:'Кубок',icon:'🏆',rarity:'common',price:100,chance:30},
      {id:'ring',name:'Кольцо',icon:'💍',rarity:'common',price:100,chance:30},
      {id:'calendar',name:'Календарь',icon:'📅',rarity:'rare',price:1500,chance:20},
      {id:'car',name:'Машина',icon:'🚗',rarity:'legendary',price:5000,chance:15},
      {id:'pepe',name:'Плюш Пепе',icon:'🐸',rarity:'legendary',price:50000,chance:5}
    ] 
  },
  { 
    id: 'admin_secret', name: '👑 Кейс Владельца', icon: '👑', price: 10, 
    items: [
      {id:'pepe',name:'Плюш Пепе',icon:'🐸',rarity:'legendary',price:50000,chance:50},
      {id:'car',name:'Машина',icon:'🚗',rarity:'legendary',price:5000,chance:30},
      {id:'calendar',name:'Календарь',icon:'📅',rarity:'rare',price:1500,chance:20}
    ] 
  }
];

// ==========================================
// БАЗА И ПОЛЬЗОВАТЕЛИ
// ==========================================
app.post('/api/register', async (req, res) => {
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
    const { data: existingUser } = await supabase.from('users').select('*').eq('login', login).single();
    if (existingUser) return res.status(400).json({ error: 'Логин уже занят' });
    const { data, error } = await supabase.from('users').insert([{ login, password, balance: 30 }]).select().single();
    if (error) return res.status(500).json({ error: error.message });
    await supabase.from('user_customization').insert([{ user_login: login }]);
    res.json({ success: true, user: data });
});

app.post('/api/login', async (req, res) => {
    const { login, password } = req.body;
    const { data: user, error } = await supabase.from('users').select('*').eq('login', login).eq('password', password).single();
    if (error || !user) return res.status(400).json({ error: 'Неверный логин или пароль' });
    res.json({ success: true, user });
});

app.get('/api/online', async (req, res) => {
    const fiveMinsAgo = new Date(Date.now() - 5 * 60000).toISOString();
    const { count } = await supabase.from('users').select('*', { count: 'exact', head: true }).gte('last_seen', fiveMinsAgo);
    res.json({ online: count || 1 });
});

app.get('/api/user/:login', async (req, res) => {
    await supabase.from('users').update({ last_seen: new Date().toISOString() }).eq('login', req.params.login);
    const { data: user, error } = await supabase.from('users').select('*').eq('login', req.params.login).single();
    if (error || !user) return res.status(404).json({ error: 'Юзер не найден' });
    
    const { data: inventory } = await supabase.from('inventory').select('*').eq('user_login', req.params.login);
    const { data: custom } = await supabase.from('user_customization').select('*').eq('user_login', req.params.login).single();
    
    const totalItems = inventory ? inventory.length : 0;
    const totalValue = inventory ? inventory.reduce((sum, item) => sum + (Number(item.price) || 0), 0) : 0;
    
    res.json({ 
        balance: user.balance, 
        inventory: inventory || [], 
        is_admin: user.is_admin || false, 
        is_super_admin: user.is_super_admin || false, 
        stats: { totalItems, totalValue },
        avatar: custom ? custom.avatar : '👤',
        frame: custom ? custom.frame : 'none',
        owned_avatars: custom ? custom.owned_avatars : ['👤'],
        owned_frames: custom ? custom.owned_frames : ['none']
    });
});

// ==========================================
// КЕЙСЫ
// ==========================================
app.get('/api/cases', async (req, res) => {
    // Отдаем захардкоженные кейсы. Секретный видит только админ.
    const { login } = req.query;
    let casesToSend = GAME_CASES.filter(c => c.id !== 'admin_secret');
    
    if (login) {
        const { data: user } = await supabase.from('users').select('is_super_admin').eq('login', login).single();
        if (user && user.is_super_admin) {
            casesToSend = GAME_CASES; // Главный админ видит секретный кейс
        }
    }
    res.json(casesToSend);
});

app.post('/api/cases/open', async (req, res) => {
    const { login, caseId } = req.body;
    const box = GAME_CASES.find(c => c.id === caseId);
    if (!box) return res.status(400).json({ error: 'Кейс не найден' });

    // Проверяем, не пытается ли обычный игрок открыть админский кейс
    if (caseId === 'admin_secret') {
        const { data: user } = await supabase.from('users').select('is_super_admin').eq('login', login).single();
        if (!user || !user.is_super_admin) return res.status(403).json({ error: 'Доступ запрещен' });
    }
    
    const price = Number(box.price);
    const { data: newBalance, error: balError } = await supabase.rpc('spend_balance', { p_login: login, p_amount: price });
    if (balError) return res.status(500).json({ error: balError.message });
    if (newBalance === null) return res.status(400).json({ error: 'Недостаточно звёзд!' });

    // Выбор предмета по шансам
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
    const { data } = await supabase.from('drop_history').select('*').order('created_at', { ascending: false }).limit(15);
    res.json(data || []);
});
