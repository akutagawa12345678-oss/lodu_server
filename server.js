// ======================================================
// LUDO MULTIPLAYER SERVER
// نسخه نهایی - WebSocket Multiplayer
// Node.js + ws
// ======================================================

const http = require("http");
const WebSocket = require("ws");

// ======================================================
// CONFIG
// ======================================================

const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;

const ROOM_EXPIRE_TIME = 30 * 60 * 1000;
const DISCONNECT_GRACE = 30 * 1000;

// ======================================================
// HTTP SERVER
// ======================================================

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache"
    });

    res.end(
        JSON.stringify({
            ok: true,
            service: "ludo-server",
            version: "3.0.0",
            players: getTotalPlayers(),
            rooms: rooms.size,
            time: Date.now()
        })
    );
});

// ======================================================
// WEBSOCKET SERVER
// ======================================================

const wss = new WebSocket.Server({
    server,
    clientTracking: true
});

// ======================================================
// ROOMS
// ======================================================

const rooms = new Map();

// ======================================================
// COLORS
// ======================================================

const PLAYER_COLORS = [
    "red",
    "green",
    "yellow",
    "blue"
];

// ======================================================
// SEND
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

// ======================================================
// BROADCAST
// ======================================================

function broadcast(room, data) {
    if (!room) return;

    for (const player of room.players.values()) {
        send(player.ws, data);
    }
}

// ======================================================
// BROADCAST EXCEPT
// ======================================================

function broadcastExcept(room, playerId, data) {
    if (!room) return;

    for (const player of room.players.values()) {
        if (player.id !== playerId) {
            send(player.ws, data);
        }
    }
}

// ======================================================
// TOTAL PLAYERS
// ======================================================

function getTotalPlayers() {
    let total = 0;

    for (const room of rooms.values()) {
        total += room.players.size;
    }

    return total;
}

// ======================================================
// ROOM ID
// ======================================================

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

// ======================================================
// PLAYER ID
// ======================================================

function generatePlayerId() {
    return (
        Math.random()
            .toString(36)
            .substring(2, 12) +
        Date.now().toString(36)
    );
}

// ======================================================
// RECONNECT TOKEN
// ======================================================

function generateReconnectToken() {
    return (
        Math.random()
            .toString(36)
            .substring(2) +
        Math.random()
            .toString(36)
            .substring(2)
    );
}

// ======================================================
// CREATE ROOM
// ======================================================

function createRoom(id) {
    return {
        id,

        players: new Map(),

        gameStarted: false,

        gameFinished: false,

        hostId: null,

        currentPlayerId: null,

        currentPlayerIndex: 0,

        dice: null,

        turn: 0,

        lastMove: null,

        createdAt: Date.now(),

        updatedAt: Date.now(),

        // وضعیت کامل بازی
        gameState: {
            turn: 0,
            dice: null,
            lastMove: null,
            rankings: [],
            eliminated: [false, false, false, false]
        }
    };
}

// ======================================================
// PLAYER INDEX
// ======================================================

function getPlayerIndex(room, playerId) {
    if (!room) return -1;

    const players =
        Array.from(room.players.values());

    return players.findIndex(
        player => player.id === playerId
    );
}

// ======================================================
// PLAYER COLOR
// ======================================================

function getPlayerColor(index) {
    return (
        PLAYER_COLORS[index] ||
        "red"
    );
}

// ======================================================
// SAFE PLAYER INFO
// ======================================================

function getPlayers(room) {
    if (!room) return [];

    return Array
        .from(room.players.values())
        .map((player, index) => ({
            id: player.id,

            index,

            name:
                player.name ||
                `Player ${index + 1}`,

            color:
                player.color ||
                getPlayerColor(index),

            ready:
                !!player.ready,

            connected:
                !!player.connected,

            isHost:
                player.id === room.hostId
        }));
}

// ======================================================
// ROOM STATE
// ======================================================

function getRoomState(room) {
    if (!room) return null;

    return {
        type: "room_state",

        roomId: room.id,

        players: getPlayers(room),

        playerCount:
            room.players.size,

        maxPlayers:
            MAX_PLAYERS,

        minPlayers:
            MIN_PLAYERS,

        gameStarted:
            room.gameStarted,

        gameFinished:
            room.gameFinished,

        hostId:
            room.hostId,

        currentPlayerId:
            room.currentPlayerId,

        currentPlayerIndex:
            room.currentPlayerIndex,

        dice:
            room.dice,

        turn:
            room.turn,

        lastMove:
            room.lastMove,

        gameState:
            room.gameState
    };
}

// ======================================================
// SEND ROOM STATE
// ======================================================

function sendRoomState(room) {
    if (!room) return;

    broadcast(
        room,
        getRoomState(room)
    );
}

// ======================================================
// START GAME
// ======================================================

function startGame(room) {
    if (!room) return false;

    if (room.gameStarted) {
        return false;
    }

    const players =
        Array.from(room.players.values())
            .filter(p => p.connected);

    if (players.length < MIN_PLAYERS) {
        return false;
    }

    room.gameStarted = true;

    room.gameFinished = false;

    room.turn = 1;

    room.currentPlayerIndex = 0;

    room.currentPlayerId =
        players[0].id;

    room.dice = null;

    room.lastMove = null;

    room.gameState = {
        turn: 1,
        dice: null,
        lastMove: null,
        rankings: [],
        eliminated:
            [false, false, false, false]
    };

    room.updatedAt = Date.now();

    broadcast(room, {
        type: "game_started",

        roomId: room.id,

        players:
            getPlayers(room),

        hostId:
            room.hostId,

        currentPlayerId:
            room.currentPlayerId,

        currentPlayerIndex:
            room.currentPlayerIndex,

        turn:
            room.turn
    });

    sendRoomState(room);

    return true;
}

// ======================================================
// NEXT TURN
// ======================================================

function nextTurn(room) {
    if (!room) return;

    const players =
        Array
            .from(room.players.values())
            .filter(p =>
                p.connected &&
                !p.eliminated
            );

    if (!players.length) {
        room.currentPlayerId = null;
        return;
    }

    let index =
        players.findIndex(
            p =>
                p.id ===
                room.currentPlayerId
        );

    if (index < 0) {
        index = -1;
    }

    let nextIndex =
        (index + 1) %
        players.length;

    room.currentPlayerIndex =
        nextIndex;

    room.currentPlayerId =
        players[nextIndex].id;

    room.turn++;

    room.dice = null;

    room.gameState.turn =
        room.turn;

    room.gameState.dice =
        null;

    room.updatedAt =
        Date.now();

    broadcast(room, {
        type: "turn_changed",

        currentPlayerId:
            room.currentPlayerId,

        currentPlayerIndex:
            room.currentPlayerIndex,

        turn:
            room.turn
    });
}

// ======================================================
// ROLL DICE
// ======================================================

function rollDice(room, playerId) {
    if (!room) {
        return {
            success: false,
            message: "اتاق وجود ندارد."
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

    const value =
        Math.floor(
            Math.random() * 6
        ) + 1;

    room.dice = value;

    room.gameState.dice =
        value;

    room.updatedAt =
        Date.now();

    broadcast(room, {
        type: "dice",

        playerId,

        playerIndex:
            getPlayerIndex(
                room,
                playerId
            ),

        value,

        turn:
            room.turn
    });

    return {
        success: true,
        value
    };
}

// ======================================================
// VALIDATE MOVE
// ======================================================

function validateMove(room, playerId, move) {
    if (!room) {
        return {
            valid: false,
            message: "اتاق پیدا نشد."
        };
    }

    if (!room.gameStarted) {
        return {
            valid: false,
            message: "بازی شروع نشده است."
        };
    }

    if (room.gameFinished) {
        return {
            valid: false,
            message: "بازی تمام شده است."
        };
    }

    if (
        room.currentPlayerId !==
        playerId
    ) {
        return {
            valid: false,
            message: "الان نوبت شما نیست."
        };
    }

    if (room.dice === null) {
        return {
            valid: false,
            message: "ابتدا تاس بریزید."
        };
    }

    if (
        !move ||
        typeof move !== "object"
    ) {
        return {
            valid: false,
            message: "اطلاعات حرکت نامعتبر است."
        };
    }

    return {
        valid: true
    };
}

// ======================================================
// MAKE MOVE
// ======================================================

function makeMove(room, playerId, moveData) {
    const validation =
        validateMove(
            room,
            playerId,
            moveData
        );

    if (!validation.valid) {
        return {
            success: false,
            message:
                validation.message
        };
    }

    const dice =
        room.dice;

    const playerIndex =
        getPlayerIndex(
            room,
            playerId
        );

    const move = {
        playerId,

        playerIndex,

        dice,

        data:
            moveData || null,

        turn:
            room.turn,

        time:
            Date.now()
    };

    room.lastMove =
        move;

    room.gameState.lastMove =
        move;

    room.gameState.dice =
        dice;

    room.updatedAt =
        Date.now();

    // ارسال حرکت به همه
    broadcast(room, {
        type: "move",

        playerId,

        playerIndex,

        dice,

        move:
            moveData || null,

        turn:
            room.turn
    });

    /*
     * فعلاً اجازه می‌دهیم کلاینت
     * نتیجه حرکت مهره را محاسبه کند.
     *
     * بعد از دریافت state_update
     * وضعیت جدید بازی در سرور ذخیره می‌شود.
     */

    return {
        success: true
    };
}

// ======================================================
// UPDATE GAME STATE
// ======================================================

function updateGameState(
    room,
    playerId,
    state
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

    if (
        room.currentPlayerId !==
        playerId
    ) {
        return {
            success: false,
            message: "فقط بازیکن فعلی می‌تواند وضعیت را ارسال کند."
        };
    }

    if (
        !state ||
        typeof state !== "object"
    ) {
        return {
            success: false,
            message: "وضعیت بازی نامعتبر است."
        };
    }

    /*
     * فقط بخش‌هایی که واقعاً
     * از game.js می‌آیند ذخیره می‌شوند.
     */

    if (
        state.pieces !== undefined
    ) {
        room.gameState.pieces =
            state.pieces;
    }

    if (
        state.rankings !== undefined
    ) {
        room.gameState.rankings =
            state.rankings;
    }

    if (
        state.eliminated !== undefined
    ) {
        room.gameState.eliminated =
            state.eliminated;
    }

    if (
        state.currentPlayer !== undefined
    ) {
        room.gameState.currentPlayer =
            state.currentPlayer;
    }

    if (
        state.gameFinished !== undefined
    ) {
        room.gameFinished =
            !!state.gameFinished;
    }

    room.updatedAt =
        Date.now();

    broadcastExcept(
        room,
        playerId,
        {
            type: "state_update",

            playerId,

            state:
                room.gameState
        }
    );

    if (room.gameFinished) {
        broadcast(room, {
            type: "game_finished",

            rankings:
                room.gameState.rankings ||
                []
        });
    }

    return {
        success: true
    };
}

// ======================================================
// FINISH GAME
// ======================================================

function finishGame(
    room,
    playerId,
    rankings
) {
    if (!room) return;

    if (
        room.currentPlayerId !==
        playerId
    ) {
        return {
            success: false,
            message: "نوبت این بازیکن نیست."
        };
    }

    room.gameFinished = true;

    room.gameState.rankings =
        Array.isArray(rankings)
            ? rankings
            : room.gameState.rankings;

    room.updatedAt =
        Date.now();

    broadcast(room, {
        type: "game_finished",

        rankings:
            room.gameState.rankings
    });

    return {
        success: true
    };
}

// ======================================================
// PLAYER READY
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

    player.ready =
        ready !== false;

    room.updatedAt =
        Date.now();

    sendRoomState(room);

    const readyPlayers =
        Array
            .from(room.players.values())
            .filter(
                p =>
                    p.ready &&
                    p.connected
            );

    if (
        readyPlayers.length >=
        MIN_PLAYERS &&
        !room.gameStarted
    ) {
        startGame(room);
    }
}

// ======================================================
// SET NAME
// ======================================================

function setPlayerName(
    room,
    playerId,
    name
) {
    if (!room) return;

    const player =
        room.players.get(
            playerId
        );

    if (!player) return;

    const cleanName =
        String(name || "")
            .trim()
            .substring(0, 20);

    if (cleanName) {
        player.name =
            cleanName;
    }

    room.updatedAt =
        Date.now();

    sendRoomState(room);
}

// ======================================================
// CREATE PLAYER
// ======================================================

function createPlayer(
    ws,
    room,
    name
) {
    const index =
        room.players.size;

    const player = {
        id:
            generatePlayerId(),

        reconnectToken:
            generateReconnectToken(),

        ws,

        name:
            String(name || "")
                .trim()
                .substring(0, 20) ||
            `Player ${index + 1}`,

        color:
            getPlayerColor(index),

        ready: false,

        connected: true,

        eliminated: false,

        disconnectedAt: null
    };

    room.players.set(
        player.id,
        player
    );

    return player;
}

// ======================================================
// SEND PLAYER DATA
// ======================================================

function sendPlayerData(
    ws,
    room,
    player
) {
    send(ws, {
        type: "player_info",

        roomId:
            room.id,

        playerId:
            player.id,

        reconnectToken:
            player.reconnectToken,

        color:
            player.color,

        index:
            getPlayerIndex(
                room,
                player.id
            )
    });
}

// ======================================================
// CONNECTION
// ======================================================

wss.on(
    "connection",
    (ws) => {

        let currentRoom = null;
        let playerId = null;

        ws.isAlive = true;

        // ------------------------------------------------
        // PONG
        // ------------------------------------------------

        ws.on("pong", () => {
            ws.isAlive = true;
        });

        // ------------------------------------------------
        // CONNECTED
        // ------------------------------------------------

        send(ws, {
            type: "connected",

            message:
                "اتصال به سرور برقرار شد.",

            version:
                "3.0.0",

            serverTime:
                Date.now()
        });

        // =================================================
        // MESSAGE
        // =================================================

        ws.on(
            "message",
            (raw) => {

                let message;

                try {
                    message =
                        JSON.parse(
                            raw.toString()
                        );
                } catch (error) {

                    send(ws, {
                        type: "error",

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
                        type: "error",

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
                        type: "pong",

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

                    if (currentRoom) {

                        send(ws, {
                            type: "error",

                            message:
                                "شما قبلاً داخل اتاق هستید."
                        });

                        return;
                    }

                    const roomId =
                        generateRoomId();

                    const room =
                        createRoom(
                            roomId
                        );

                    const player =
                        createPlayer(
                            ws,
                            room,
                            message.name
                        );

                    room.hostId =
                        player.id;

                    currentRoom =
                        room;

                    playerId =
                        player.id;

                    rooms.set(
                        roomId,
                        room
                    );

                    send(ws, {
                        type:
                            "room_created",

                        roomId,

                        playerId:
                            player.id,

                        reconnectToken:
                            player.reconnectToken,

                        color:
                            player.color,

                        index: 0
                    });

                    sendPlayerData(
                        ws,
                        room,
                        player
                    );

                    sendRoomState(
                        room
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

                    if (currentRoom) {

                        send(ws, {
                            type: "error",

                            message:
                                "شما قبلاً داخل اتاق هستید."
                        });

                        return;
                    }

                    const roomId =
                        String(
                            message.roomId ||
                            ""
                        )
                            .trim()
                            .toUpperCase();

                    const room =
                        rooms.get(
                            roomId
                        );

                    if (!room) {

                        send(ws, {
                            type: "error",

                            message:
                                "اتاق پیدا نشد."
                        });

                        return;
                    }

                    if (
                        room.gameStarted
                    ) {

                        send(ws, {
                            type: "error",

                            message:
                                "بازی این اتاق شروع شده است."
                        });

                        return;
                    }

                    if (
                        room.players.size >=
                        MAX_PLAYERS
                    ) {

                        send(ws, {
                            type: "error",

                            message:
                                "اتاق پر است."
                        });

                        return;
                    }

                    const player =
                        createPlayer(
                            ws,
                            room,
                            message.name
                        );

                    currentRoom =
                        room;

                    playerId =
                        player.id;

                    send(ws, {
                        type:
                            "joined_room",

                        roomId:
                            room.id,

                        playerId:
                            player.id,

                        reconnectToken:
                            player.reconnectToken,

                        color:
                            player.color,

                        index:
                            getPlayerIndex(
                                room,
                                player.id
                            )
                    });

                    sendPlayerData(
                        ws,
                        room,
                        player
                    );

                    broadcast(
                        room,
                        {
                            type:
                                "player_joined",

                            player:
                                {
                                    id:
                                        player.id,

                                    name:
                                        player.name,

                                    color:
                                        player.color,

                                    index:
                                        getPlayerIndex(
                                            room,
                                            player.id
                                        )
                                }
                        }
                    );

                    sendRoomState(
                        room
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

                    const roomId =
                        String(
                            message.roomId ||
                            ""
                        )
                            .trim()
                            .toUpperCase();

                    const token =
                        String(
                            message.reconnectToken ||
                            ""
                        );

                    const room =
                        rooms.get(
                            roomId
                        );

                    if (!room) {

                        send(ws, {
                            type: "error",

                            message:
                                "اتاق پیدا نشد."
                        });

                        return;
                    }

                    let found =
                        null;

                    for (
                        const player
                        of room.players.values()
                    ) {

                        if (
                            player.reconnectToken ===
                            token
                        ) {

                            found =
                                player;

                            break;
                        }
                    }

                    if (!found) {

                        send(ws, {
                            type: "error",

                            message:
                                "اطلاعات اتصال مجدد معتبر نیست."
                        });

                        return;
                    }

                    found.ws =
                        ws;

                    found.connected =
                        true;

                    found.disconnectedAt =
                        null;

                    currentRoom =
                        room;

                    playerId =
                        found.id;

                    send(ws, {
                        type:
                            "reconnected",

                        roomId:
                            room.id,

                        playerId:
                            found.id,

                        color:
                            found.color
                    });

                    sendPlayerData(
                        ws,
                        room,
                        found
                    );

                    send(
                        ws,
                        getRoomState(
                            room
                        )
                    );

                    broadcastExcept(
                        room,
                        found.id,
                        {
                            type:
                                "player_reconnected",

                            playerId:
                                found.id
                        }
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
                        !currentRoom ||
                        !playerId
                    ) {

                        send(ws, {
                            type: "error",

                            message:
                                "ابتدا وارد اتاق شوید."
                        });

                        return;
                    }

                    setPlayerName(
                        currentRoom,
                        playerId,
                        message.name
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
                        !currentRoom ||
                        !playerId
                    ) {

                        send(ws, {
                            type: "error",

                            message:
                                "ابتدا وارد اتاق شوید."
                        });

                        return;
                    }

                    setReady(
                        currentRoom,
                        playerId,
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
                        !currentRoom ||
                        !playerId
                    ) {

                        send(ws, {
                            type: "error",

                            message:
                                "ابتدا وارد اتاق شوید."
                        });

                        return;
                    }

                    if (
                        currentRoom.hostId !==
                        playerId
                    ) {

                        send(ws, {
                            type: "error",

                            message:
                                "فقط سازنده اتاق می‌تواند بازی را شروع کند."
                        });

                        return;
                    }

                    if (
                        currentRoom.players.size <
                        MIN_PLAYERS
                    ) {

                        send(ws, {
                            type: "error",

                            message:
                                "حداقل ۲ بازیکن لازم است."
                        });

                        return;
                    }

                    if (
                        startGame(
                            currentRoom
                        )
                    ) {

                        return;
                    }

                    send(ws, {
                        type: "error",

                        message:
                            "شروع بازی انجام نشد."
                    });

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
                        !currentRoom ||
                        !playerId
                    ) {

                        send(ws, {
                            type: "error",

                            message:
                                "ابتدا وارد اتاق شوید."
                        });

                        return;
                    }

                    const result =
                        rollDice(
                            currentRoom,
                            playerId
                        );

                    if (
                        !result.success
                    ) {

                        send(ws, {
                            type: "error",

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
                        !currentRoom ||
                        !playerId
                    ) {

                        send(ws, {
                            type: "error",

                            message:
                                "ابتدا وارد اتاق شوید."
                        });

                        return;
                    }

                    const result =
                        makeMove(
                            currentRoom,
                            playerId,
                            message.move ||
                                null
                        );

                    if (
                        !result.success
                    ) {

                        send(ws, {
                            type: "error",

                            message:
                                result.message
                        });

                        return;
                    }

                    /*
                     * فعلاً تغییر نوبت را
                     * کلاینت بعد از اتمام
                     * حرکت اعلام می‌کند.
                     */

                    return;
                }

                // =========================================
                // STATE UPDATE
                // =========================================

                if (
                    message.type ===
                    "state_update"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
                    ) {

                        send(ws, {
                            type: "error",

                            message:
                                "ابتدا وارد اتاق شوید."
                        });

                        return;
                    }

                    const result =
                        updateGameState(
                            currentRoom,
                            playerId,
                            message.state
                        );

                    if (
                        !result.success
                    ) {

                        send(ws, {
                            type: "error",

                            message:
                                result.message
                        });
                    }

                    return;
                }

                // =========================================
                // NEXT TURN
                // =========================================

                if (
                    message.type ===
                    "next_turn"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
                    ) {
                        return;
                    }

                    if (
                        currentRoom.currentPlayerId !==
                        playerId
                    ) {
                        send(ws, {
                            type: "error",

                            message:
                                "نوبت این بازیکن نیست."
                        });

                        return;
                    }

                    nextTurn(
                        currentRoom
                    );

                    return;
                }

                // =========================================
                // FINISH
                // =========================================

                if (
                    message.type ===
                    "game_finished"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
                    ) {
                        return;
                    }

                    finishGame(
                        currentRoom,
                        playerId,
                        message.rankings
                    );

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
                        !currentRoom
                    ) {

                        send(ws, {
                            type: "error",

                            message:
                                "شما داخل اتاق نیستید."
                        });

                        return;
                    }

                    send(
                        ws,
                        getRoomState(
                            currentRoom
                        )
                    );

                    return;
                }

                // =========================================
                // LEAVE ROOM
                // =========================================

                if (
                    message.type ===
                    "leave_room"
                ) {

                    leaveRoom(
                        true
                    );

                    return;
                }

                // =========================================
                // UNKNOWN
                // =========================================

                send(ws, {
                    type: "error",

                    message:
                        `نوع پیام "${message.type}" شناخته نشد.`
                });
            }
        );

        // =================================================
        // CLOSE
        // =================================================

        ws.on(
            "close",
            () => {

                disconnectPlayer();
            }
        );

        // =================================================
        // ERROR
        // =================================================

        ws.on(
            "error",
            error => {

                console.error(
                    "WebSocket error:",
                    error.message
                );
            }
        );

        // =================================================
        // DISCONNECT
        // =================================================

        function disconnectPlayer() {

            if (
                !currentRoom ||
                !playerId
            ) {
                return;
            }

            const room =
                currentRoom;

            const player =
                room.players.get(
                    playerId
                );

            if (!player) {
                return;
            }

            /*
             * اگر اتصال قطع شد،
             * بازیکن را فوراً حذف نمی‌کنیم.
             * ۳۰ ثانیه فرصت reconnect دارد.
             */

            player.connected =
                false;

            player.ws =
                null;

            player.disconnectedAt =
                Date.now();

            broadcastExcept(
                room,
                playerId,
                {
                    type:
                        "player_disconnected",

                    playerId,

                    gracePeriod:
                        DISCONNECT_GRACE
                }
            );

            sendRoomState(
                room
            );

            setTimeout(
                () => {

                    if (
                        !rooms.has(
                            room.id
                        )
                    ) {
                        return;
                    }

                    const current =
                        room.players.get(
                            playerId
                        );

                    if (!current) {
                        return;
                    }

                    if (
                        current.connected
                    ) {
                        return;
                    }

                    if (
                        !current.disconnectedAt
                    ) {
                        return;
                    }

                    if (
                        Date.now() -
                        current.disconnectedAt <
                        DISCONNECT_GRACE
                    ) {
                        return;
                    }

                    removePlayer(
                        room,
                        playerId
                    );

                },
                DISCONNECT_GRACE + 1000
            );

            currentRoom =
                null;

            playerId =
                null;
        }

        // =================================================
        // LEAVE ROOM
        // =================================================

        function leaveRoom(
            immediate
        ) {

            if (
                !currentRoom ||
                !playerId
            ) {
                return;
            }

            const room =
                currentRoom;

            const id =
                playerId;

            if (immediate) {
                removePlayer(
                    room,
                    id
                );
            }

            currentRoom =
                null;

            playerId =
                null;
        }
    }
);

// ======================================================
// REMOVE PLAYER
// ======================================================

function removePlayer(
    room,
    playerId
) {
    if (!room) return;

    const player =
        room.players.get(
            playerId
        );

    if (!player) return;

    const wasCurrent =
        room.currentPlayerId ===
        playerId;

    const wasHost =
        room.hostId ===
        playerId;

    room.players.delete(
        playerId
    );

    // ==================================================
    // EMPTY ROOM
    // ==================================================

    if (
        room.players.size === 0
    ) {

        rooms.delete(
            room.id
        );

        return;
    }

    // ==================================================
    // NEW HOST
    // ==================================================

    if (wasHost) {

        const first =
            Array
                .from(
                    room.players.values()
                )[0];

        room.hostId =
            first.id;
    }

    // ==================================================
    // CURRENT PLAYER LEFT
    // ==================================================

    if (wasCurrent) {

        const players =
            Array
                .from(
                    room.players.values()
                )
                .filter(
                    p =>
                        p.connected &&
                        !p.eliminated
                );

        if (players.length) {

            room.currentPlayerIndex = 0;

            room.currentPlayerId =
                players[0].id;

            room.dice =
                null;

            broadcast(
                room,
                {
                    type:
                        "turn_changed",

                    currentPlayerId:
                        room.currentPlayerId,

                    currentPlayerIndex:
                        0,

                    turn:
                        room.turn
                }
            );
        } else {

            room.currentPlayerId =
                null;

            room.dice =
                null;
        }
    }

    // ==================================================
    // NOTIFY
    // ==================================================

    broadcast(
        room,
        {
            type:
                "player_left",

            playerId,

            playerCount:
                room.players.size,

            hostId:
                room.hostId
        }
    );

    sendRoomState(
        room
    );
}

// ======================================================
// HEARTBEAT
// ======================================================

const heartbeat =
    setInterval(
        () => {

            for (
                const ws
                of wss.clients
            ) {

                if (
                    ws.isAlive === false
                ) {

                    try {
                        ws.terminate();
                    } catch {}

                    continue;
                }

                ws.isAlive =
                    false;

                try {
                    ws.ping();
                } catch {}
            }

        },
        30000
    );

// ======================================================
// CLEANUP
// ======================================================

setInterval(
    () => {

        const now =
            Date.now();

        for (
            const [roomId, room]
            of rooms
        ) {

            if (
                room.players.size === 0
            ) {

                rooms.delete(
                    roomId
                );

                continue;
            }

            if (
                now -
                room.updatedAt >
                ROOM_EXPIRE_TIME
            ) {

                /*
                 * اگر بازی فعال نیست
                 * و مدت زیادی بدون
                 * فعالیت مانده باشد.
                 */

                if (
                    !room.gameStarted
                ) {

                    rooms.delete(
                        roomId
                    );

                    console.log(
                        `Expired room: ${roomId}`
                    );
                }
            }
        }

    },
    5 * 60 * 1000
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
            " LUDO MULTIPLAYER SERVER"
        );

        console.log(
            "======================================"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            `Max players: ${MAX_PLAYERS}`
        );

        console.log(
            `WebSocket: ws://0.0.0.0:${PORT}`
        );

        console.log(
            "Server is ready."
        );

        console.log(
            "======================================"
        );
    }
);

// ======================================================
// PROCESS CLEANUP
// ======================================================

process.on(
    "SIGTERM",
    () => {

        clearInterval(
            heartbeat
        );

        server.close(
            () => {
                process.exit(0);
            }
        );
    }
);

process.on(
    "SIGINT",
    () => {

        clearInterval(
            heartbeat
        );

        server.close(
            () => {
                process.exit(0);
            }
        );
    }
);
