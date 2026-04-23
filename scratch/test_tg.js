const title='test'; 
const body='test body'; 
const dateStr='now'; 
const tgMsg = `<b>🚀 AISHOP SYSTEM ALERT</b>\n──────────────────\n<b>📌 Tiêu đề:</b> ${title}\n<b>📝 Nội dung:</b> ${body}\n──────────────────\n<b>🕒 Thời gian:</b> <code>${dateStr}</code>`; 
fetch('https://api.telegram.org/bot8747296534:AAG9oIcwz9wXUfd2Yxyl-T0Zjl-iDH1jr50/sendMessage', {
    method:'POST', 
    headers:{'Content-Type':'application/json'}, 
    body: JSON.stringify({chat_id: '5609346884', text: tgMsg, parse_mode: 'HTML'})
}).then(r => r.json()).then(console.log);
