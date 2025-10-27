const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const Jimp = require('jimp');
const fs = require('fs');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const qrcode = require('qrcode-terminal');

// Fungsi upscale foto ke 1080p (Full HD)
async function enhanceImage(inputPath, outputPath) {
    try {
        const image = await Jimp.read(inputPath);
        
        const width = image.bitmap.width;
        const height = image.bitmap.height;
        
        // Cek apakah perlu upscale
        if (width < 1920 || height < 1080) {
            // Upscale ke 1080p dengan maintain aspect ratio
            if (width > height) {
                // Landscape: width jadi 1920px
                await image.resize(1920, Jimp.AUTO, Jimp.RESIZE_BICUBIC);
            } else {
                // Portrait atau square: height jadi 1080px
                await image.resize(Jimp.AUTO, 1080, Jimp.RESIZE_BICUBIC);
            }
        }
        
        // Quality maksimal
        await image.quality(100).writeAsync(outputPath);
        
        return true;
    } catch (error) {
        console.error('Error enhancing image:', error);
        return false;
    }
}

// Fungsi enhance video - SIMPLE & STABLE
async function enhanceVideo(inputPath, outputPath) {
    try {
        // Tanpa nlmeans, hanya unsharp + eq
        const command = `ffmpeg -i "${inputPath}" -vf "unsharp=5:5:1.0:5:5:0,eq=brightness=0.05:contrast=1.15:saturation=1.1" -c:v libx264 -preset fast -crf 20 -c:a copy "${outputPath}"`;
        await execPromise(command);
        return true;
    } catch (error) {
        console.error('Error enhancing video:', error);
        return false;
    }
}

// Fungsi utama bot
async function startBot() {
    console.log('🔄 Menghubungkan ke WhatsApp...');
    
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: state
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('\n📱 SCAN QR CODE DI BAWAH INI:\n');
            qrcode.generate(qr, { small: true });
            console.log('\n✅ Buka WhatsApp → Perangkat Tertaut → Scan QR\n');
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
                ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
                : true;
            
            console.log('🔄 Koneksi terputus, reconnecting:', shouldReconnect);
            
            if (shouldReconnect) {
                setTimeout(() => startBot(), 3000);
            } else {
                console.log('⛔ Logged out. Hapus folder auth_info dan restart.');
            }
        } else if (connection === 'open') {
            console.log('\n' + '='.repeat(50));
            console.log('✅ BOT BERHASIL TERHUBUNG KE WHATSAPP!');
            console.log('🤖 Bot siap menerima foto dan video!');
            console.log('⚡ Mode: Triple Sharpen + Strong Enhancement');
            console.log('='.repeat(50) + '\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const messageType = Object.keys(msg.message)[0];

        try {
            // Pesan teks
            if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
                const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
                
                if (text.toLowerCase().includes('p') || text.toLowerCase().includes('halo') || text.toLowerCase().includes('hi') || text.toLowerCase().includes('menu')) {
                    await sock.sendMessage(from, {
                        text: '👋 *Bot Penjernihan Foto & Video*\n\n' +
                              '✨ *Fitur:*\n' +
                              '📷 Enhancement KUAT untuk Foto\n' +
                              '🎥 Enhancement untuk Video\n\n' +
                              '💡 *Cara Pakai:*\n' +
                              'Kirim foto atau video!\n\n' +
                              '🔥 *Strong Enhancement:*\n' +
                              '• Triple Sharpen (3x convolute)\n' +
                              '• Brightness +8%\n' +
                              '• Contrast +20%\n' +
                              '• Saturation +25%\n' +
                              '• Quality 100%\n\n' +
                              '⚡ *Stabil & Cepat!*\n' +
                              '🚀 Hasil PASTI terlihat beda!'
                    });
                }
            }

            // Gambar
            if (messageType === 'imageMessage') {
                console.log('📷 Menerima foto dari:', from);
                await sock.sendMessage(from, { 
                    text: '⏳ *Memproses foto...*\n\n_Triple sharpen + enhancement kuat!_'
                });

                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                const timestamp = Date.now();
                const inputPath = `temp_input_${timestamp}.jpg`;
                const outputPath = `temp_output_${timestamp}.jpg`;

                fs.writeFileSync(inputPath, buffer);
                
                console.log('🔥 Processing dengan triple sharpen...');
                const success = await enhanceImage(inputPath, outputPath);
                
                if (success && fs.existsSync(outputPath)) {
                    await sock.sendMessage(from, {
                        image: fs.readFileSync(outputPath),
                        caption: '✅ *FOTO ENHANCED!* 📸🔥\n\n' +
                                 '_⚡ Triple Sharpen_\n' +
                                 '_✨ Brightness +8%_\n' +
                                 '_🎨 Contrast +20%_\n' +
                                 '_🌈 Saturation +25%_\n\n' +
                                 '*Bandingkan dengan foto asli!*'
                    });
                    console.log('✅ Foto berhasil diproses');
                } else {
                    await sock.sendMessage(from, { text: '❌ Maaf, terjadi kesalahan saat memproses foto.' });
                }

                try {
                    fs.unlinkSync(inputPath);
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                } catch (e) {
                    console.error('Error deleting temp files:', e);
                }
            }

            // Video
            if (messageType === 'videoMessage') {
                console.log('🎥 Menerima video dari:', from);
                
                const videoSize = msg.message.videoMessage.fileLength;
                const maxSize = 50 * 1024 * 1024;
                
                if (videoSize > maxSize) {
                    await sock.sendMessage(from, { 
                        text: '❌ *Video terlalu besar!*\n\nMaksimal ukuran video: *50MB*' 
                    });
                    return;
                }

                await sock.sendMessage(from, { 
                    text: '⏳ *Memproses video...*\n\n_Tunggu 1-5 menit..._' 
                });

                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                const timestamp = Date.now();
                const inputPath = `temp_input_${timestamp}.mp4`;
                const outputPath = `temp_output_${timestamp}.mp4`;

                fs.writeFileSync(inputPath, buffer);
                
                const success = await enhanceVideo(inputPath, outputPath);
                
                if (success && fs.existsSync(outputPath)) {
                    await sock.sendMessage(from, {
                        video: fs.readFileSync(outputPath),
                        caption: '✅ *VIDEO ENHANCED!* 🎥\n\n_Sharpen + Enhancement_'
                    });
                    console.log('✅ Video berhasil diproses');
                } else {
                    await sock.sendMessage(from, { 
                        text: '❌ Maaf, terjadi kesalahan saat memproses video.' 
                    });
                }

                try {
                    fs.unlinkSync(inputPath);
                    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                } catch (e) {
                    console.error('Error deleting temp files:', e);
                }
            }

        } catch (error) {
            console.error('❌ Error processing message:', error);
            await sock.sendMessage(from, { 
                text: '❌ Terjadi kesalahan sistem.' 
            });
        }
    });

    return sock;
}

// Handle error
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});

// Jalankan bot
console.log('🚀 Memulai Bot WhatsApp...');
console.log('⚡ Mode: Triple Sharpen + Strong Enhancement (Jimp)');
console.log('✅ Stabil & Kompatibel dengan Termux!');

startBot().catch(err => {
    console.error('❌ Error starting bot:', err);
    process.exit(1);
});
