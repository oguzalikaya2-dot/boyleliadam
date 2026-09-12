const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let activeUsers = {};
let chatHistory = [];
let activeProcesses = {};

io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    socket.on('join_user', (username) => {
        activeUsers[socket.id] = { name: username, voice: 'Bağlı Değil' };
        io.emit('update_users', activeUsers);
        socket.emit('load_history', chatHistory);
    });

    socket.on('send_message', (data) => {
        const msgObj = { user: data.user, text: data.text };
        chatHistory.push(msgObj);
        if (chatHistory.length > 50) chatHistory.shift();
        io.emit('receive_message', msgObj);
    });

    socket.on('change_voice_channel', (channelName) => {
        if (activeUsers[socket.id]) {
            const oldChannel = activeUsers[socket.id].voice;
            activeUsers[socket.id].voice = channelName;
            io.emit('update_users', activeUsers);

            if (channelName !== 'Bağlı Değil') {
                io.emit('voice_notification', `🔊 ${activeUsers[socket.id].name}, "${channelName}" odasına katıldı.`);
            } else if (oldChannel !== 'Bağlı Değil') {
                io.emit('voice_notification', `🔇 ${activeUsers[socket.id].name} sesten ayrıldı.`);
            }
        }
    });

    // PYTHONIOENCODING ile Türkçe karakter sorununu çözen spawn yapısı
    socket.on('run_python', () => {
        const scriptPath = path.join(__dirname, 'script.py');
        
        if (activeProcesses[socket.id]) {
            try { activeProcesses[socket.id].kill(); } catch(e){}
        }

        const pyProcess = spawn('python', ['-u', scriptPath], {
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });
        activeProcesses[socket.id] = pyProcess;

        pyProcess.stdout.on('data', (data) => {
            socket.emit('python_data', data.toString());
        });

        pyProcess.stderr.on('data', (data) => {
            socket.emit('python_data', data.toString());
        });

        pyProcess.on('close', (code) => {
            socket.emit('python_data', `\n[İşlem tamamlandı, çıkış kodu: ${code}]\n`);
            delete activeProcesses[socket.id];
        });

        pyProcess.on('error', (err) => {
            const altProcess = spawn('py', ['-u', scriptPath], {
                env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
            });
            activeProcesses[socket.id] = altProcess;
            
            altProcess.stdout.on('data', (data) => { socket.emit('python_data', data.toString()); });
            altProcess.stderr.on('data', (data) => { socket.emit('python_data', data.toString()); });
            altProcess.on('close', () => { delete activeProcesses[socket.id]; });
        });
    });

    socket.on('python_input', (text) => {
        if (activeProcesses[socket.id]) {
            try {
                activeProcesses[socket.id].stdin.write(text + '\n');
            } catch (e) {
                socket.emit('python_data', `\n[Girdi gönderilemedi: ${e.message}]\n`);
            }
        } else {
            socket.emit('python_data', '\n[Çalışan aktif bir script yok! Önce "Scripti Başlat" butonuna basın.]\n');
        }
    });

    socket.on('disconnect', () => {
        if (activeProcesses[socket.id]) {
            try { activeProcesses[socket.id].kill(); } catch(e){}
            delete activeProcesses[socket.id];
        }
        delete activeUsers[socket.id];
        io.emit('update_users', activeUsers);
        console.log('Bir kullanıcı ayrıldı:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Sunucu çalışıyor: http://localhost:${PORT}`);
});