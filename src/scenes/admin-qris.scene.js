const { Scenes, Markup } = require('telegraf');
const db = require('../database');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function downloadFile(url, filename) {
  const saveDir = path.join(__dirname, '../../uploads/qris');
  if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
  }
  const savePath = path.join(saveDir, filename);
  const writer = fs.createWriteStream(savePath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(`/uploads/qris/${filename}`));
    writer.on('error', reject);
  });
}

const adminQrisScene = new Scenes.WizardScene(
    'ADMIN_ADD_QRIS_SCENE',
    async (ctx) => {
        await ctx.reply('➕ *TAMBAH QRIS*\n\nSilakan kirimkan NAMA untuk QRIS ini (contoh: QRIS Kilat Store):', { parse_mode: 'Markdown' });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        ctx.scene.state.qrisName = ctx.message.text;

        await ctx.reply(`Nama QRIS: *${ctx.scene.state.qrisName}*\n\nSekarang silakan kirim/upload (sebagai Foto) gambar QRIS tersebut:`, { parse_mode: 'Markdown' });
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.photo) {
            await ctx.reply('❌ Mohon kirimkan / upload gambar (foto).');
            return;
        }
        
        await ctx.reply('⏳ Sedang memproses dan menyimpan QRIS...');
        
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileId = photo.file_id;
        
        try {
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            const filename = `qris_${Date.now()}_${ctx.from.id}.jpg`;
            const localPath = await downloadFile(fileUrl.href, filename);
            
            await db.query(`INSERT INTO qris_accounts (qris_name, qris_image, is_active) VALUES (?, ?, 1)`, [ctx.scene.state.qrisName, localPath]);
            
            await ctx.reply(`✅ *QRIS Berhasil Ditambahkan!*\n\nNama: ${ctx.scene.state.qrisName}\nStatus: Aktif\n\nMenggunakan gambar yang Anda kirim. User sekarang dapat melakukan pembayaran melalui QRIS ini.`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('Kembali ke Admin Menu', 'ADMIN_MENU')]]) });
        } catch(e) {
            await ctx.reply(`❌ Gagal menyimpan QRIS: ${e.message}`);
        }

        return ctx.scene.leave();
    }
);

module.exports = adminQrisScene;
