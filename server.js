// ======================================================
// LUDO MULTIPLAYER SERVER
// نسخه نهایی Real-Time Multiplayer
// Node.js + WebSocket
// ======================================================

const http = require("http");
const WebSocket = require("ws");

// ======================================================
// CONFIG
// ======================================================

const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;

const TURN_TIME = 20;

const ROOM_EXPIRE_TIME = 30 * 60 * 1000;

const RECONNECT_TIME = 2 * 60 * 1000;

// ======================================================
// HTTP SERVER
// ======================================================

const server = http.createServer((req, res) => {

    res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    });

    if (req.method === "OPTIONS") {
        res.end();
        return;
    }

    res.end(JSON.stringify({
        ok: true,
        service: "ludo-server",
        version: "3.0.0",
        multiplayer: true,
        rooms: rooms.size,
        players: getTotalPlayers(),
        uptime: Math.floor(process.uptime())
    }));
});

// ======================================================
// WEBSOCKET
// ======================================================

const wss = new WebSocket.Server({
    server
});

// ======================================================
// ROOMS
// ======================================================

const rooms = new Map();

// ======================================================
// HELPERS
// ======================================================

function send(ws, data) {

    if (!ws) return;

    if (ws.readyState === WebSocket.OPEN) {

        try {
            ws.send(JSON.stringify(data));
        } catch (error) {
            console.error("Send error:", error.message);
        }

    }

}

function broadcast(room, data) {

    if (!room) return;

    for (const player of room.players.values()) {

        send(player.ws, data);

    }

}

function broadcastExcept(room, playerId, data) {

    if (!room) return;

    for (const player of room.players.values()) {

        if (player.id !== playerId) {

            send(player.ws, data);

        }

    }

}

function getTotalPlayers() {

    let total = 0;

    for (const room of rooms.values()) {

        for (const player of room.players.values()) {

            if (player.connected) {

                total++;

            }

        }

    }

    return total;

}

function generateRoomId() {

    let id;

    do {

        id =
            Math.random()
                .toString(36)
                .substring(2, 8)
                .toUpperCase();

    } while (rooms.has(id));

    return id;

}

function generatePlayerId() {

    return (
        Math.random()
            .toString(36)
            .substring(2, 12)
        +
        Date.now().toString(36)
    );

}

function generateReconnectToken() {

    return (
        Math.random()
            .toString(36)
            .substring(2, 18)
        +
        Date.now().toString(36)
    );

}

function randomDice() {

    return Math.floor(Math.random() * 6) + 1;

}

// ======================================================
// COLORS
// ======================================================

const COLORS = [
    "red",
    "green",
    "yellow",
    "blue"
];

function getPlayerColor(index) {

    return COLORS[index] || "red";

}

// ======================================================
// SAFE CELLS
// استاندارد لودو
// در صورت متفاوت بودن صفحه بازی، کلاینت می‌تواند
// موقعیت تصویری خودش را مدیریت کند.
// ======================================================

const SAFE_PROGRESS = new Set([
    0
]);

// ======================================================
// CREATE PLAYER
// ======================================================

function createPlayer({
    id,
    name,
    index
}) {

    return {

        id,

        ws: null,

        name:
            String(name || "")
                .trim()
                .substring(0, 20)
            ||
            `Player ${index + 1}`,

        index,

        color:
            getPlayerColor(index),

        ready: false,

        connected: true,

        reconnectToken:
            generateReconnectToken(),

        disconnectedAt: null,

        // چهار مهره
        pieces: [
            { progress: -1 },
            { progress: -1 },
            { progress: -1 },
            { progress: -1 }
        ],

        finished: false,

        rank: null,

        timeoutCount: 0

    };

}

// ======================================================
// CREATE ROOM
// ======================================================

function createRoom(roomId) {

    return {

        id: roomId,

        players: new Map(),

        createdAt: Date.now(),

        lastActivity: Date.now(),

        gameStarted: false,

        gameFinished: false,

        currentPlayerIndex: 0,

        currentPlayerId: null,

        dice: null,

        dicePlayerId: null,

        waitingForPiece: false,

        turn: 0,

        turnStartedAt: null,

        turnTime: TURN_TIME,

        rankings: [],

        lastMove: null,

        winner: null,

        stateVersion: 1

    };

}

// ======================================================
// ROOM PLAYERS
// ======================================================

function getPlayers(room) {

    return Array.from(
        room.players.values()
    ).map(player => ({

        id: player.id,

        index: player.index,

        name: player.name,

        color: player.color,

        ready: player.ready,

        connected: player.connected,

        finished: player.finished,

        rank: player.rank,

        timeoutCount: player.timeoutCount

    }));

}

// ======================================================
// PUBLIC GAME STATE
// ======================================================

function getPublicGameState(room) {

    return {

        roomId: room.id,

        gameStarted:
            room.gameStarted,

        gameFinished:
            room.gameFinished,

        currentPlayerId:
            room.currentPlayerId,

        currentPlayerIndex:
            room.currentPlayerIndex,

        dice:
            room.dice,

        dicePlayerId:
            room.dicePlayerId,

        waitingForPiece:
            room.waitingForPiece,

        turn:
            room.turn,

        turnStartedAt:
            room.turnStartedAt,

        turnTime:
            room.turnTime,

        rankings:
            [...room.rankings],

        winner:
            room.winner,

        lastMove:
            room.lastMove,

        players:
            getPlayers(room),

        stateVersion:
            room.stateVersion

    };

}

// ======================================================
// SEND FULL STATE
// ======================================================

function sendFullState(room) {

    if (!room) return;

    room.stateVersion++;

    broadcast(room, {

        type: "game_state",

        state:
            getPublicGameState(room)

    });

}

// ======================================================
// SEND PRIVATE PLAYER STATE
// ======================================================

function sendPrivateState(room, player) {

    if (!room || !player) return;

    send(player.ws, {

        type: "player_state",

        player: {

            id: player.id,

            index: player.index,

            color: player.color,

            name: player.name,

            pieces:
                player.pieces,

            reconnectToken:
                player.reconnectToken

        }

    });

}

// ======================================================
// RESET PIECES
// ======================================================

function resetPlayerPieces(player) {

    player.pieces = [

        { progress: -1 },
        { progress: -1 },
        { progress: -1 },
        { progress: -1 }

    ];

    player.finished = false;

    player.rank = null;

}

// ======================================================
// START GAME
// ======================================================

function startGame(room) {

    if (!room) return false;

    if (room.players.size < MIN_PLAYERS) {

        return false;

    }

    if (room.gameStarted) {

        return false;

    }

    const players =
        Array.from(room.players.values());

    players.sort(
        (a, b) =>
            a.index - b.index
    );

    for (const player of players) {

        resetPlayerPieces(player);

        player.timeoutCount = 0;

    }

    room.gameStarted = true;

    room.gameFinished = false;

    room.currentPlayerIndex = 0;

    room.currentPlayerId =
        players[0].id;

    room.dice = null;

    room.dicePlayerId = null;

    room.waitingForPiece = false;

    room.turn = 1;

    room.turnStartedAt =
        Date.now();

    room.rankings = [];

    room.winner = null;

    room.lastMove = null;

    room.lastActivity =
        Date.now();

    broadcast(room, {

        type: "game_started",

        state:
            getPublicGameState(room)

    });

    for (const player of players) {

        sendPrivateState(
            room,
            player
        );

    }

    return true;

}

// ======================================================
// ACTIVE PLAYERS
// ======================================================

function getActivePlayers(room) {

    if (!room) return [];

    return Array.from(
        room.players.values()
    ).filter(player => {

        return (
            player.connected &&
            !player.finished
        );

    });

}

// ======================================================
// NEXT ACTIVE PLAYER
// ======================================================

function findNextPlayer(room) {

    const players =
        Array.from(
            room.players.values()
        ).sort(
            (a, b) =>
                a.index - b.index
        );

    if (!players.length) {

        return null;

    }

    let start =
        room.currentPlayerIndex;

    for (let i = 1; i <= players.length; i++) {

        const index =
            (start + i) %
            players.length;

        const player =
            players.find(
                p =>
                    p.index === index
            );

        if (
            player &&
            player.connected &&
            !player.finished
        ) {

            return player;

        }

    }

    return null;

}

// ======================================================
// NEXT TURN
// ======================================================

function nextTurn(room) {

    if (!room) return;

    if (room.gameFinished) return;

    const next =
        findNextPlayer(room);

    if (!next) {

        finishGame(room);

        return;

    }

    room.currentPlayerIndex =
        next.index;

    room.currentPlayerId =
        next.id;

    room.dice = null;

    room.dicePlayerId = null;

    room.waitingForPiece = false;

    room.turn++;

    room.turnStartedAt =
        Date.now();

    room.lastActivity =
        Date.now();

    sendFullState(room);

}

// ======================================================
// DICE
// ======================================================

function handleRollDice(
    room,
    playerId
) {

    if (!room) {

        return {
            success: false,
            message: "اتاق پیدا نشد."
        };

    }

    if (!room.gameStarted) {

        return {
            success: false,
            message: "بازی هنوز شروع نشده است."
        };

    }

    if (room.gameFinished) {

        return {
            success: false,
            message: "بازی تمام شده است."
        };

    }

    if (
        room.currentPlayerId !==
        playerId
    ) {

        return {
            success: false,
            message: "الان نوبت شما نیست."
        };

    }

    if (room.dice !== null) {

        return {
            success: false,
            message: "تاس قبلاً ریخته شده است."
        };

    }

    const player =
        room.players.get(playerId);

    if (!player || !player.connected) {

        return {
            success: false,
            message: "بازیکن متصل نیست."
        };

    }

    const value =
        randomDice();

    room.dice =
        value;

    room.dicePlayerId =
        playerId;

    room.waitingForPiece =
        true;

    room.lastActivity =
        Date.now();

    broadcast(room, {

        type: "dice_rolled",

        playerId,

        value,

        turn:
            room.turn

    });

    sendFullState(room);

    return {
        success: true,
        value
    };

}

// ======================================================
// MOVE VALIDATION
// ======================================================

function validateMove(
    player,
    pieceIndex,
    dice
) {

    if (
        !player ||
        pieceIndex < 0 ||
        pieceIndex > 3
    ) {

        return {
            valid: false,
            message: "مهره نامعتبر است."
        };

    }

    if (
        !Number.isInteger(dice) ||
        dice < 1 ||
        dice > 6
    ) {

        return {
            valid: false,
            message: "تاس نامعتبر است."
        };

    }

    const piece =
        player.pieces[pieceIndex];

    const progress =
        piece.progress;

    // خانه
    if (progress === -1) {

        if (dice !== 6) {

            return {
                valid: false,
                message:
                    "برای خارج کردن مهره باید ۶ بیاورید."
            };

        }

        return {
            valid: true,
            from: -1,
            to: 0
        };

    }

    // مهره قبلاً به پایان رسیده
    if (progress === 58) {

        return {
            valid: false,
            message:
                "این مهره قبلاً به پایان رسیده است."
        };

    }

    const next =
        progress + dice;

    // بیشتر از خانه آخر
    if (next > 58) {

        return {
            valid: false,
            message:
                "عدد تاس برای این مهره زیاد است."
        };

    }

    return {
        valid: true,
        from: progress,
        to: next
    };

}

// ======================================================
// MOVE
// ======================================================

function handleMove(
    room,
    playerId,
    move
) {

    if (!room) {

        return {
            success: false,
            message: "اتاق پیدا نشد."
        };

    }

    if (!room.gameStarted) {

        return {
            success: false,
            message: "بازی شروع نشده است."
        };

    }

    if (room.gameFinished) {

        return {
            success: false,
            message: "بازی تمام شده است."
        };

    }

    if (
        room.currentPlayerId !==
        playerId
    ) {

        return {
            success: false,
            message: "الان نوبت شما نیست."
        };

    }

    if (
        room.dice === null ||
        room.dicePlayerId !== playerId
    ) {

        return {
            success: false,
            message:
                "ابتدا تاس بریزید."
        };

    }

    const player =
        room.players.get(playerId);

    if (!player) {

        return {
            success: false,
            message: "بازیکن پیدا نشد."
        };

    }

    const pieceIndex =
        Number(
            move &&
            move.pieceIndex
        );

    if (
        !Number.isInteger(pieceIndex)
    ) {

        return {
            success: false,
            message:
                "شماره مهره نامعتبر است."
        };

    }

    const dice =
        room.dice;

    const validation =
        validateMove(
            player,
            pieceIndex,
            dice
        );

    if (!validation.valid) {

        return {
            success: false,
            message:
                validation.message
        };

    }

    const piece =
        player.pieces[pieceIndex];

    const oldProgress =
        piece.progress;

    const newProgress =
        validation.to;

    piece.progress =
        newProgress;

    // -----------------------------------------------
    // MOVE DATA
    // -----------------------------------------------

    room.lastMove = {

        playerId,

        playerIndex:
            player.index,

        pieceIndex,

        dice,

        from:
            oldProgress,

        to:
            newProgress,

        time:
            Date.now()

    };

    room.lastActivity =
        Date.now();

    // -----------------------------------------------
    // CHECK PLAYER FINISHED
    // -----------------------------------------------

    const finished =
        player.pieces.every(
            p =>
                p.progress === 58
        );

    if (finished) {

        player.finished = true;

        if (!room.rankings.includes(
            player.index
        )) {

            room.rankings.push(
                player.index
            );

        }

        player.rank =
            room.rankings.length;

    }

    // -----------------------------------------------
    // CAPTURE
    // -----------------------------------------------

    let captured = [];

    if (
        newProgress >= 0 &&
        newProgress < 52
    ) {

        captured =
            capturePlayers(
                room,
                player,
                pieceIndex
            );

    }

    // -----------------------------------------------
    // BROADCAST MOVE
    // -----------------------------------------------

    broadcast(room, {

        type: "move",

        playerId,

        playerIndex:
            player.index,

        pieceIndex,

        dice,

        from:
            oldProgress,

        to:
            newProgress,

        captured,

        finished:
            player.finished,

        rank:
            player.rank,

        rankings:
            [...room.rankings]

    });

    // -----------------------------------------------
    // GAME FINISH
    // -----------------------------------------------

    const active =
        getActivePlayers(room);

    if (
        active.length <= 1
    ) {

        if (
            active.length === 1
        ) {

            const last =
                active[0];

            if (
                !room.rankings.includes(
                    last.index
                )
            ) {

                room.rankings.push(
                    last.index
                );

                last.rank =
                    room.rankings.length;

            }

        }

        finishGame(room);

        return {
            success: true
        };

    }

    // -----------------------------------------------
    // EXTRA TURN ON SIX
    // -----------------------------------------------

    if (
        dice === 6 &&
        !player.finished
    ) {

        room.dice =
            null;

        room.dicePlayerId =
            null;

        room.waitingForPiece =
            false;

        room.turnStartedAt =
            Date.now();

        sendFullState(room);

        return {
            success: true,
            extraTurn: true
        };

    }

    // -----------------------------------------------
    // NEXT PLAYER
    // -----------------------------------------------

    nextTurn(room);

    return {
        success: true,
        extraTurn: false
    };

}

// ======================================================
// CAPTURE
// ======================================================

function capturePlayers(
    room,
    attacker,
    attackerPieceIndex
) {

    const captured = [];

    const attackerPiece =
        attacker.pieces[
            attackerPieceIndex
        ];

    const attackerProgress =
        attackerPiece.progress;

    for (
        const opponent
        of room.players.values()
    ) {

        if (
            opponent.id ===
            attacker.id
        ) continue;

        if (
            !opponent.connected
        ) continue;

        for (
            let i = 0;
            i < opponent.pieces.length;
            i++
        ) {

            const piece =
                opponent.pieces[i];

            if (
                piece.progress < 0 ||
                piece.progress >= 52
            ) {

                continue;

            }

            // ------------------------------------------------
            // استاندارد چندنفره:
            // مسیر اصلی با شروع‌های 0 / 13 / 26 / 39
            // ------------------------------------------------

            const attackerBoard =
                getBoardPosition(
                    attacker.index,
                    attackerProgress
                );

            const opponentBoard =
                getBoardPosition(
                    opponent.index,
                    piece.progress
                );

            if (
                attackerBoard !== null &&
                opponentBoard !== null &&
                attackerBoard ===
                opponentBoard
            ) {

                // خانه امن
                if (
                    isSafeBoardPosition(
                        attackerBoard
                    )
                ) {

                    continue;

                }

                piece.progress = -1;

                captured.push({

                    playerId:
                        opponent.id,

                    playerIndex:
                        opponent.index,

                    pieceIndex:
                        i

                });

            }

        }

    }

    return captured;

}

// ======================================================
// BOARD POSITION
// ======================================================

function getBoardPosition(
    playerIndex,
    progress
) {

    if (
        progress < 0 ||
        progress >= 52
    ) {

        return null;

    }

    const starts = [
        0,
        13,
        26,
        39
    ];

    const start =
        starts[playerIndex] || 0;

    return (
        start +
        progress
    ) % 52;

}

// ======================================================
// SAFE BOARD POSITIONS
// ======================================================

const SAFE_BOARD_POSITIONS = new Set([
    0,
    8,
    13,
    21,
    26,
    34,
    39,
    47
]);

function isSafeBoardPosition(
    position
) {

    return SAFE_BOARD_POSITIONS.has(
        position
    );

}

// ======================================================
// FINISH GAME
// ======================================================

function finishGame(room) {

    if (!room) return;

    if (room.gameFinished) return;

    room.gameFinished =
        true;

    room.gameStarted =
        true;

    room.dice =
        null;

    room.dicePlayerId =
        null;

    room.waitingForPiece =
        false;

    room.turnStartedAt =
        null;

    // آخرین بازیکن باقی مانده
    const active =
        getActivePlayers(room);

    if (
        active.length === 1
    ) {

        const winner =
            active[0];

        if (
            !room.rankings.includes(
                winner.index
            )
        ) {

            room.rankings.push(
                winner.index
            );

            winner.rank =
                room.rankings.length;

        }

    }

    room.winner =
        room.rankings.length
            ? room.rankings[0]
            : null;

    room.lastActivity =
        Date.now();

    broadcast(room, {

        type: "game_finished",

        rankings:
            [...room.rankings],

        winner:
            room.winner,

        state:
            getPublicGameState(room)

    });

}

// ======================================================
// TIMEOUT
// ======================================================

function checkTurnTimeout(room) {

    if (!room) return;

    if (!room.gameStarted) return;

    if (room.gameFinished) return;

    if (!room.turnStartedAt) return;

    const elapsed =
        Date.now() -
        room.turnStartedAt;

    if (
        elapsed <
        room.turnTime * 1000
    ) {

        return;

    }

    const player =
        room.players.get(
            room.currentPlayerId
        );

    if (!player) {

        nextTurn(room);

        return;

    }

    player.timeoutCount++;

    broadcast(room, {

        type: "turn_timeout",

        playerId:
            player.id,

        playerIndex:
            player.index,

        timeoutCount:
            player.timeoutCount

    });

    // بعد از سه timeout حذف
    if (
        player.timeoutCount >= 3
    ) {

        player.finished = true;

        if (
            !room.rankings.includes(
                player.index
            )
        ) {

            room.rankings.push(
                player.index
            );

            player.rank =
                room.rankings.length;

        }

        broadcast(room, {

            type: "player_eliminated",

            playerId:
                player.id,

            playerIndex:
                player.index,

            reason:
                "timeout",

            rank:
                player.rank

        });

    }

    const active =
        getActivePlayers(room);

    if (
        active.length <= 1
    ) {

        finishGame(room);

        return;

    }

    nextTurn(room);

}

// ======================================================
// READY
// ======================================================

function setReady(
    room,
    playerId,
    ready
) {

    if (!room) return;

    const player =
        room.players.get(
            playerId
        );

    if (!player) return;

    if (room.gameStarted) {

        return;

    }

    player.ready =
        ready !== false;

    room.lastActivity =
        Date.now();

    broadcast(room, {

        type: "player_ready",

        playerId,

        ready:
            player.ready

    });

    sendRoomState(room);

    const players =
        Array.from(
            room.players.values()
        );

    const readyPlayers =
        players.filter(
            p =>
                p.ready
        );

    if (
        readyPlayers.length >=
        MIN_PLAYERS
    ) {

        startGame(room);

    }

}

// ======================================================
// ROOM STATE
// ======================================================

function sendRoomState(room) {

    if (!room) return;

    broadcast(room, {

        type: "room_state",

        roomId:
            room.id,

        players:
            getPlayers(room),

        playerCount:
            room.players.size,

        connectedPlayers:
            getTotalConnectedPlayers(room),

        maxPlayers:
            MAX_PLAYERS,

        gameStarted:
            room.gameStarted,

        gameFinished:
            room.gameFinished

    });

}

function getTotalConnectedPlayers(room) {

    if (!room) return 0;

    let count = 0;

    for (
        const player
        of room.players.values()
    ) {

        if (player.connected) {

            count++;

        }

    }

    return count;

}

// ======================================================
// CREATE ROOM
// ======================================================

function handleCreateRoom(
    ws,
    message,
    connection
) {

    if (connection.room) {

        send(ws, {

            type: "error",

            message:
                "شما قبلاً داخل یک اتاق هستید."

        });

        return;

    }

    const roomId =
        generateRoomId();

    const room =
        createRoom(roomId);

    const player =
        createPlayer({

            id:
                generatePlayerId(),

            name:
                message.name,

            index:
                0

        });

    player.ws =
        ws;

    room.players.set(
        player.id,
        player
    );

    rooms.set(
        roomId,
        room
    );

    connection.room =
        room;

    connection.playerId =
        player.id;

    send(ws, {

        type:
            "room_created",

        roomId,

        playerId:
            player.id,

        reconnectToken:
            player.reconnectToken,

        color:
            player.color

    });

    sendRoomState(room);

    sendPrivateState(
        room,
        player
    );

}

// ======================================================
// JOIN ROOM
// ======================================================

function handleJoinRoom(
    ws,
    message,
    connection
) {

    if (connection.room) {

        send(ws, {

            type: "error",

            message:
                "شما قبلاً داخل یک اتاق هستید."

        });

        return;

    }

    const roomId =
        String(
            message.roomId || ""
        )
        .trim()
        .toUpperCase();

    if (!roomId) {

        send(ws, {

            type: "error",

            message:
                "کد اتاق وارد نشده است."

        });

        return;

    }

    const room =
        rooms.get(roomId);

    if (!room) {

        send(ws, {

            type: "error",

            message:
                "اتاق پیدا نشد."

        });

        return;

    }

    if (room.gameFinished) {

        send(ws, {

            type: "error",

            message:
                "این بازی تمام شده است."

        });

        return;

    }

    // بازیکنان disconnected را حساب می‌کنیم
    // تا امکان reconnect داشته باشند.
    const players =
        Array.from(
            room.players.values()
        );

    if (
        players.length >=
        MAX_PLAYERS
    ) {

        send(ws, {

            type: "error",

            message:
                "اتاق پر است."

        });

        return;

    }

    const index =
        players.length;

    const player =
        createPlayer({

            id:
                generatePlayerId(),

            name:
                message.name,

            index

        });

    player.ws =
        ws;

    room.players.set(
        player.id,
        player
    );

    connection.room =
        room;

    connection.playerId =
        player.id;

    room.lastActivity =
        Date.now();

    send(ws, {

        type:
            "joined_room",

        roomId:
            room.id,

        playerId:
            player.id,

        reconnectToken:
            player.reconnectToken,

        index:
            player.index,

        color:
            player.color

    });

    sendRoomState(room);

    sendPrivateState(
        room,
        player
    );

}

// ======================================================
// RECONNECT
// ======================================================

function handleReconnect(
    ws,
    message,
    connection
) {

    const roomId =
        String(
            message.roomId || ""
        )
        .trim()
        .toUpperCase();

    const token =
        String(
            message.reconnectToken || ""
        );

    if (!roomId || !token) {

        send(ws, {

            type: "error",

            message:
                "اطلاعات اتصال مجدد ناقص است."

        });

        return;

    }

    const room =
        rooms.get(roomId);

    if (!room) {

        send(ws, {

            type: "error",

            message:
                "اتاق پیدا نشد."

        });

        return;

    }

    let player = null;

    for (
        const p
        of room.players.values()
    ) {

        if (
            p.reconnectToken ===
            token
        ) {

            player = p;

            break;

        }

    }

    if (!player) {

        send(ws, {

            type: "error",

            message:
                "توکن اتصال مجدد معتبر نیست."

        });

        return;

    }

    player.ws =
        ws;

    player.connected =
        true;

    player.disconnectedAt =
        null;

    connection.room =
        room;

    connection.playerId =
        player.id;

    room.lastActivity =
        Date.now();

    send(ws, {

        type:
            "reconnected",

        roomId:
            room.id,

        playerId:
            player.id,

        index:
            player.index,

        color:
            player.color,

        reconnectToken:
            player.reconnectToken

    });

    sendPrivateState(
        room,
        player
    );

    send(ws, {

        type:
            "game_state",

        state:
            getPublicGameState(room)

    });

    broadcastExcept(
        room,
        player.id,
        {

            type:
                "player_reconnected",

            playerId:
                player.id,

            playerIndex:
                player.index

        }
    );

}

// ======================================================
// LEAVE ROOM
// ======================================================

function leaveRoom(
    connection,
    permanent = false
) {

    const room =
        connection.room;

    const playerId =
        connection.playerId;

    if (!room || !playerId) {

        return;

    }

    const player =
        room.players.get(
            playerId
        );

    if (!player) {

        return;

    }

    // --------------------------------------------------
    // اتصال قطع شده:
    // بازیکن را فوراً حذف نمی‌کنیم.
    // امکان reconnect دارد.
    // --------------------------------------------------

    if (!permanent) {

        player.connected =
            false;

        player.ws =
            null;

        player.disconnectedAt =
            Date.now();

        broadcastExcept(
            room,
            player.id,
            {

                type:
                    "player_disconnected",

                playerId:
                    player.id,

                playerIndex:
                    player.index

            }
        );

        sendRoomState(room);

        // اگر نوبت خودش بود،
        // نفر بعدی بعد از کمی زمان.
        if (
            room.currentPlayerId ===
            player.id &&
            room.gameStarted &&
            !room.gameFinished
        ) {

            setTimeout(
                () => {

                    if (!rooms.has(room.id)) {
                        return;
                    }

                    const current =
                        room.players.get(
                            player.id
                        );

                    if (
                        current &&
                        !current.connected &&
                        room.currentPlayerId ===
                        player.id
                    ) {

                        nextTurn(room);

                    }

                },
                3000
            );

        }

        return;

    }

    // --------------------------------------------------
    // حذف کامل
    // --------------------------------------------------

    room.players.delete(
        playerId
    );

    broadcast(
        room,
        {

            type:
                "player_left",

            playerId,

            playerIndex:
                player.index

        }
    );

    if (
        room.players.size === 0
    ) {

        rooms.delete(
            room.id
        );

        return;

    }

    if (
        room.currentPlayerId ===
        playerId &&
        room.gameStarted &&
        !room.gameFinished
    ) {

        nextTurn(room);

    } else {

        sendRoomState(room);

    }

}

// ======================================================
// MESSAGE HANDLER
// ======================================================

wss.on(
    "connection",
    (ws, request) => {

        const connection = {

            ws,

            room: null,

            playerId: null

        };

        // ------------------------------------------------
        // CONNECTED
        // ------------------------------------------------

        send(ws, {

            type:
                "connected",

            message:
                "اتصال به سرور برقرار شد.",

            serverTime:
                Date.now(),

            version:
                "3.0.0"

        });

        // ------------------------------------------------
        // MESSAGE
        // ------------------------------------------------

        ws.on(
            "message",
            raw => {

                let message;

                try {

                    message =
                        JSON.parse(
                            raw.toString()
                        );

                } catch (error) {

                    send(ws, {

                        type:
                            "error",

                        message:
                            "پیام نامعتبر است."

                    });

                    return;

                }

                if (
                    !message ||
                    !message.type
                ) {

                    send(ws, {

                        type:
                            "error",

                        message:
                            "نوع پیام مشخص نیست."

                    });

                    return;

                }

                // =========================================
                // PING
                // =========================================

                if (
                    message.type ===
                    "ping"
                ) {

                    send(ws, {

                        type:
                            "pong",

                        time:
                            Date.now()

                    });

                    return;

                }

                // =========================================
                // CREATE ROOM
                // =========================================

                if (
                    message.type ===
                    "create_room"
                ) {

                    handleCreateRoom(
                        ws,
                        message,
                        connection
                    );

                    return;

                }

                // =========================================
                // JOIN ROOM
                // =========================================

                if (
                    message.type ===
                    "join_room"
                ) {

                    handleJoinRoom(
                        ws,
                        message,
                        connection
                    );

                    return;

                }

                // =========================================
                // RECONNECT
                // =========================================

                if (
                    message.type ===
                    "reconnect"
                ) {

                    handleReconnect(
                        ws,
                        message,
                        connection
                    );

                    return;

                }

                // =========================================
                // SET NAME
                // =========================================

                if (
                    message.type ===
                    "set_name"
                ) {

                    if (
                        !connection.room
                    ) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                "ابتدا وارد اتاق شوید."

                        });

                        return;

                    }

                    const player =
                        connection.room.players.get(
                            connection.playerId
                        );

                    if (!player) return;

                    player.name =
                        String(
                            message.name || ""
                        )
                        .trim()
                        .substring(
                            0,
                            20
                        )
                        ||
                        player.name;

                    sendRoomState(
                        connection.room
                    );

                    return;

                }

                // =========================================
                // READY
                // =========================================

                if (
                    message.type ===
                    "ready"
                ) {

                    if (
                        !connection.room
                    ) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                "ابتدا وارد اتاق شوید."

                        });

                        return;

                    }

                    setReady(

                        connection.room,

                        connection.playerId,

                        message.ready

                    );

                    return;

                }

                // =========================================
                // START GAME
                // =========================================

                if (
                    message.type ===
                    "start_game"
                ) {

                    if (
                        !connection.room
                    ) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                "ابتدا وارد اتاق شوید."

                        });

                        return;

                    }

                    const room =
                        connection.room;

                    if (
                        room.players.size <
                        MIN_PLAYERS
                    ) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                "حداقل ۲ بازیکن لازم است."

                        });

                        return;

                    }

                    if (
                        room.gameStarted
                    ) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                "بازی قبلاً شروع شده است."

                        });

                        return;

                    }

                    startGame(room);

                    return;

                }

                // =========================================
                // ROLL DICE
                // =========================================

                if (
                    message.type ===
                    "roll_dice"
                ) {

                    if (
                        !connection.room
                    ) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                "ابتدا وارد اتاق شوید."

                        });

                        return;

                    }

                    const result =
                        handleRollDice(

                            connection.room,

                            connection.playerId

                        );

                    if (!result.success) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                result.message

                        });

                    }

                    return;

                }

                // =========================================
                // MOVE
                // =========================================

                if (
                    message.type ===
                    "move"
                ) {

                    if (
                        !connection.room
                    ) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                "ابتدا وارد اتاق شوید."

                        });

                        return;

                    }

                    const result =
                        handleMove(

                            connection.room,

                            connection.playerId,

                            message.move || {}

                        );

                    if (!result.success) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                result.message

                        });

                    }

                    return;

                }

                // =========================================
                // GET STATE
                // =========================================

                if (
                    message.type ===
                    "get_state"
                ) {

                    if (
                        !connection.room
                    ) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                "شما داخل اتاق نیستید."

                        });

                        return;

                    }

                    send(ws, {

                        type:
                            "game_state",

                        state:
                            getPublicGameState(
                                connection.room
                            )

                    });

                    const player =
                        connection.room.players.get(
                            connection.playerId
                        );

                    if (player) {

                        sendPrivateState(

                            connection.room,

                            player

                        );

                    }

                    return;

                }

                // =========================================
                // LEAVE
                // =========================================

                if (
                    message.type ===
                    "leave_room"
                ) {

                    leaveRoom(
                        connection,
                        true
                    );

                    connection.room =
                        null;

                    connection.playerId =
                        null;

                    return;

                }

                // =========================================
                // UNKNOWN
                // =========================================

                send(ws, {

                    type:
                        "error",

                    message:
                        `نوع پیام "${message.type}" شناخته نشد.`

                });

            }
        );

        // ------------------------------------------------
        // CLOSE
        // ------------------------------------------------

        ws.on(
            "close",
            () => {

                leaveRoom(
                    connection,
                    false
                );

            }
        );

        // ------------------------------------------------
        // ERROR
        // ------------------------------------------------

        ws.on(
            "error",
            error => {

                console.error(
                    "WebSocket error:",
                    error.message
                );

            }
        );

    }
);

// ======================================================
// HEARTBEAT
// ======================================================

const heartbeatInterval =
    setInterval(
        () => {

            for (
                const ws
                of wss.clients
            ) {

                if (
                    ws.readyState ===
                    WebSocket.OPEN
                ) {

                    send(ws, {

                        type:
                            "heartbeat",

                        time:
                            Date.now()

                    });

                }

            }

        },
        25000
    );

// ======================================================
// TURN TIMER
// ======================================================

const turnInterval =
    setInterval(
        () => {

            for (
                const room
                of rooms.values()
            ) {

                try {

                    checkTurnTimeout(
                        room
                    );

                } catch (error) {

                    console.error(
                        "Turn timer error:",
                        error.message
                    );

                }

            }

        },
        1000
    );

// ======================================================
// CLEANUP ROOMS
// ======================================================

const cleanupInterval =
    setInterval(
        () => {

            const now =
                Date.now();

            for (
                const [roomId, room]
                of rooms
            ) {

                // اتاق خالی
                if (
                    room.players.size === 0
                ) {

                    rooms.delete(
                        roomId
                    );

                    continue;

                }

                // بازیکنان قطع‌شده قدیمی
                for (
                    const [playerId, player]
                    of room.players
                ) {

                    if (
                        !player.connected &&
                        player.disconnectedAt &&
                        now -
                        player.disconnectedAt >
                        RECONNECT_TIME
                    ) {

                        room.players.delete(
                            playerId
                        );

                        broadcast(
                            room,
                            {

                                type:
                                    "player_left",

                                playerId,

                                playerIndex:
                                    player.index

                            }
                        );

                    }

                }

                // اتاق بدون فعالیت
                if (
                    room.players.size === 0 &&
                    now -
                    room.lastActivity >
                    ROOM_EXPIRE_TIME
                ) {

                    rooms.delete(
                        roomId
                    );

                }

            }

        },
        30000
    );

// ======================================================
// SERVER ERROR
// ======================================================

server.on(
    "error",
    error => {

        console.error(
            "HTTP server error:",
            error
        );

    }
);

// ======================================================
// START
// ======================================================

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            "======================================"
        );

        console.log(
            "LUDO MULTIPLAYER SERVER"
        );

        console.log(
            "======================================"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            "WebSocket: ENABLED"
        );

        console.log(
            "Multiplayer: ENABLED"
        );

        console.log(
            "Version: 3.0.0"
        );

        console.log(
            "======================================"
        );

    }
);

// ======================================================
// SHUTDOWN
// ======================================================

function shutdown() {

    console.log(
        "Shutting down server..."
    );

    clearInterval(
        heartbeatInterval
    );

    clearInterval(
        turnInterval
    );

    clearInterval(
        cleanupInterval
    );

    for (
        const ws
        of wss.clients
    ) {

        try {

            ws.close();

        } catch (error) {}

    }

    server.close(
        () => {

            process.exit(0);

        }
    );

}

process.on(
    "SIGTERM",
    shutdown
);

process.on(
    "SIGINT",
    shutdown
);
