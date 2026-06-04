const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PIECE_DATABASE = {
    'Pawn': { name: '병사', moveDirs: ['1','2','3','4','6','8'], attackDirs: ['2','4','6'], moveRange: 1, attackRange: 1, tier: 'Basics', desc: '처음 이동 시 2칸 전진 가능.' },
    'Mercenary': { name: '용병', moveDirs: ['1','2','3','4','6','7','8','9'], attackDirs: ['2','4','6'], moveRange: 1, attackRange: 1, tier: 'Common', desc: '특별한 효과가 없습니다.' },
    'Assassin': { name: '암살자', moveDirs: ['2','4','6','8'], attackDirs: ['1','3','7','9'], moveRange: 1, attackRange: 1, tier: 'Common', desc: '처치 시 다음 한 턴간 일회성 은신 획득.' },
    'Berserker': { name: '광전사', moveDirs: ['2','4','6'], attackDirs: ['2','4','6'], moveRange: 1, attackRange: 1, tier: 'Rare', desc: '적 처치 시 이번 턴에 한 번 더 이동 가능.' },
    'RushWarrior': { name: '돌격병', moveDirs: ['1','2','3'], attackDirs: ['1','2','3'], moveRange: 1, attackRange: 1, tier: 'Rare', desc: '한 턴에 이동 2회와 공격 1회가 가능합니다.' },
    'Apprentice': { name: '견습생', moveDirs: ['2','4','6','8'], attackDirs: ['2','4','6'], moveRange: 1, attackRange: 1, tier: 'Epic', desc: '적 기물 2개 처치 시 나이트로 변신합니다.' },
    'SuicideBomber': { name: '자살폭탄병', moveDirs: ['2','4','6'], attackDirs: ['2','4','6'], moveRange: 1, attackRange: 1, tier: 'Epic', desc: '사망 시 폭탄 설치. 폭탄 칸 이동 가능. 자신 턴 시작 시 폭발.' },
    'GhostKnight': { name: '기사의 영혼', moveDirs: ['1','3','4','6'], attackDirs: ['1','2','3'], moveRange: 1, attackRange: 1, tier: 'Legend', desc: '첫 공격 전까지 타겟팅 불가능한 은신 상태.' },
    'Bomb': { name: '시한폭탄', moveDirs: [], attackDirs: [], moveRange: 0, attackRange: 0, tier: 'Basics', desc: '자신 턴 시작 시 해당 칸의 적을 처치하고 소멸.' },
    'Knight': { name: '나이트(진화)', moveDirs: ['L'], attackDirs: ['L'], moveRange: 1, attackRange: 1, tier: 'Legend', desc: '견습생이 진화한 형태입니다. 체스의 나이트처럼 이동합니다.' }
};

const games = {}; 

function createInitialBoard(deckA, deckB) {
    let board = Array(8).fill(null).map(() => Array(8).fill(null));
    const defaultDeck = ['Pawn', 'Mercenary', 'Assassin', 'Berserker', 'RushWarrior', 'Apprentice', 'SuicideBomber', 'GhostKnight'];
    const setupA = deckA && deckA.length >= 6 ? deckA : defaultDeck;
    const setupB = deckB && deckB.length >= 6 ? deckB : defaultDeck;
    
    for(let i = 0; i < 8; i++) {
        let typeB = setupB[i] ? setupB[i] : 'GhostKnight';
        let typeA = setupA[i] ? setupA[i] : 'GhostKnight';
        board[1][i] = { type: typeB, player: 'B', id: `B-${typeB}-${i}-${Math.random().toString(36).substring(2,5)}`, isFirstMove: true, stealth: typeB === 'GhostKnight', killCount: 0, assassinStealthTurn: 0 };
        board[6][i] = { type: typeA, player: 'A', id: `A-${typeA}-${i}-${Math.random().toString(36).substring(2,5)}`, isFirstMove: true, stealth: typeA === 'GhostKnight', killCount: 0, assassinStealthTurn: 0 };
    }
    return board;
}

io.on('connection', (socket) => {
    socket.on('createRoom', ({ customDeck }) => {
        let roomId = '';
        for (let i = 0; i < 8; i++) roomId += Math.floor(Math.random() * 10).toString();
        games[roomId] = { 
            players: [socket.id], decks: { [socket.id]: customDeck }, board: null, 
            turn: socket.id, activePiece: null, hasMoved: false, hasAttacked: false,
            rushMoveLeft: 2, rushAttackLeft: 1, berserkerBonusMove: false 
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId });
    });

    socket.on('joinRoom', ({ roomId, customDeck }) => {
        const game = games[roomId];
        if (!game || game.players.length >= 2) return;
        game.players.push(socket.id);
        game.decks[socket.id] = customDeck; 
        game.board = createInitialBoard(game.decks[game.players[0]], game.decks[game.players[1]]);
        socket.join(roomId);
        io.to(roomId).emit('gameStarted', { roomId, players: game.players, board: game.board, turn: game.turn, db: PIECE_DATABASE });
    });

    socket.on('actionMove', ({ roomId, from, to }) => {
        const game = games[roomId];
        if (!game || game.turn !== socket.id) return;
        const piece = game.board[from.y][from.x];
        if (!piece) return;

        if (piece.type === 'RushWarrior') {
            if (game.rushMoveLeft <= 0) return;
            game.board[from.y][from.x] = null;
            game.board[to.y][to.x] = piece; 
            game.rushMoveLeft--;
            game.activePiece = { x: to.x, y: to.y };
            if (game.rushMoveLeft <= 0) game.hasMoved = true;
        } else if (piece.type === 'Berserker' && game.berserkerBonusMove) {
            game.board[from.y][from.x] = null;
            game.board[to.y][to.x] = piece;
            game.berserkerBonusMove = false; 
            game.hasMoved = true;
            game.activePiece = { x: to.x, y: to.y };
        } else {
            if (game.hasMoved) return;
            game.board[from.y][from.x] = null;
            game.board[to.y][to.x] = piece;
            piece.isFirstMove = false; 
            game.hasMoved = true;
            game.activePiece = { x: to.x, y: to.y };
        }

        io.to(roomId).emit('actionProcessed', { board: game.board, hasMoved: game.hasMoved, hasAttacked: game.hasAttacked, activePiece: game.activePiece, rushMoveLeft: game.rushMoveLeft, rushAttackLeft: game.rushAttackLeft, berserkerBonusMove: game.berserkerBonusMove });
    });

    socket.on('actionAttack', ({ roomId, from, to }) => {
        const game = games[roomId];
        if (!game || game.turn !== socket.id) return;
        const attacker = game.board[from.y][from.x];
        const target = game.board[to.y][to.x];
        if (!attacker || !target || target.player === attacker.player) return;

        if (attacker.type === 'RushWarrior' && game.rushAttackLeft <= 0) return;

        if (attacker.type === 'GhostKnight') attacker.stealth = false;
        if (attacker.type === 'Assassin') { attacker.stealth = true; attacker.assassinStealthTurn = 2; }
        if (attacker.type === 'Berserker') { game.berserkerBonusMove = true; game.hasMoved = false; }
        if (attacker.type === 'Apprentice') {
            attacker.killCount++;
            if (attacker.killCount >= 2) { attacker.type = 'Knight'; attacker.killCount = 0; }
        }

        if (target.type === 'SuicideBomber') game.board[to.y][to.x] = { type: 'Bomb', player: target.player };
        else game.board[to.y][to.x] = null;

        if (attacker.type === 'RushWarrior') {
            game.rushAttackLeft--;
            if (game.rushAttackLeft <= 0) game.hasAttacked = true;
        } else {
            game.hasAttacked = true;
        }

        io.to(roomId).emit('actionProcessed', { board: game.board, hasMoved: game.hasMoved, hasAttacked: game.hasAttacked, activePiece: game.activePiece, rushMoveLeft: game.rushMoveLeft, rushAttackLeft: game.rushAttackLeft, berserkerBonusMove: game.berserkerBonusMove });
    });

    socket.on('endTurn', (roomId) => {
        const game = games[roomId];
        if (!game || game.turn !== socket.id) return;
        forceNextTurn(roomId);
    });

    function forceNextTurn(roomId) {
        const game = games[roomId];
        const currentTurnPlayer = game.players[0] === game.turn ? 'A' : 'B';
        const nextTurnPlayer = game.players[0] === game.turn ? 'B' : 'A';

        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const p = game.board[y][x];
                if (p && p.type === 'Bomb' && p.player === nextTurnPlayer) game.board[y][x] = null;
                if (p && p.player === currentTurnPlayer && p.type === 'Assassin' && p.stealth) {
                    p.assassinStealthTurn--;
                    if (p.assassinStealthTurn <= 0) p.stealth = false;
                }
            }
        }
        game.turn = game.players.find(id => id !== game.turn);
        game.hasMoved = false; game.hasAttacked = false; game.activePiece = null;
        game.rushMoveLeft = 2; game.rushAttackLeft = 1; game.berserkerBonusMove = false;
        io.to(roomId).emit('turnSwapped', { turn: game.turn, board: game.board });
    }
    socket.on('disconnect', () => { /* 삭제 로직 생략 가능 */ });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`서버 가동: ${PORT}`));
