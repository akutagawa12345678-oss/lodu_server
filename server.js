// ======================================================
// LUDO MULTIPLAYER SERVER
// نسخه 3.0.0
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

// ======================================================
// HTTP SERVER
// ======================================================

const server = http.createServer((req, res) => {

    res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache"
    });

    res.end(JSON.stringify({
        ok: true,
        service: "ludo-server",
        version: "3.0.0",
        websocket: true,
        rooms: rooms.size,
        players: getTotalPlayers()
    }));

});

// ======================================================
// WEBSOCKET SERVER
// ======================================================

const wss = new WebSocket.Server({
    server
});

// ======================================================
// ROOMS
// ======================================================

const rooms = new Map();

// ======================================================
// CONSTANTS
// ======================================================

const COLORS = [
    "red",
    "green",
    "yellow",
    "blue"
];

// ======================================================
// HELPERS
// ======================================================

function send(ws, data) {

    if (!ws) return;

    if (ws.readyState !== WebSocket.OPEN) {
        return;
    }

    try {
        ws.send(JSON.stringify(data));
    } catch (error) {
        console.error("Send error:", error.message);
    }

}

// ------------------------------------------------------

function broadcast(room, data) {

    if (!room) return;

    for (const player of room.players.values()) {
        send(player.ws, data);
    }

}

// ------------------------------------------------------

function broadcastExcept(room, playerId, data) {

    if (!room) return;

    for (const player of room.players.values()) {

        if (player.id === playerId) {
            continue;
        }

        send(player.ws, data);
    }

}

// ------------------------------------------------------

function getTotalPlayers() {

    let total = 0;

    for (const room of rooms.values()) {
        total += room.players.size;
    }

    return total;

}

// ------------------------------------------------------

function generateRoomId() {

    let id;

    do {

        id = Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase();

    } while (rooms.has(id));

    return id;

}

// ------------------------------------------------------

function generatePlayerId() {

    return (
        Math.random()
            .toString(36)
            .substring(2, 12) +
        Date.now().toString(36)
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

        currentPlayerIndex: 0,

        currentPlayerId: null,

        dice: null,

        turn: 0,

        lastMove: null,

        gameState: {

            pieces: {},

            rankings: [],

            eliminated: {},

            finished: false

        },

        createdAt: Date.now(),

        updatedAt: Date.now()

    };

}

// ======================================================
// PLAYER LIST
// ======================================================

function getPlayers(room) {

    if (!room) return [];

    return Array
        .from(room.players.values())
        .map((player, index) => {

            return {

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
                    !!player.connected

            };

        });

}

// ======================================================
// PLAYER COLOR
// ======================================================

function getPlayerColor(index) {

    return COLORS[index] || "red";

}

// ======================================================
// ROOM STATE
// ======================================================

function getRoomState(room) {

    return {

        type: "room_state",

        roomId: room.id,

        players:
            getPlayers(room),

        playerCount:
            room.players.size,

        maxPlayers:
            MAX_PLAYERS,

        minPlayers:
            MIN_PLAYERS,

        gameStarted:
            room.gameStarted,

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

    if (!room) {

        return {
            success: false,
            message: "اتاق پیدا نشد."
        };

    }

    if (room.gameStarted) {

        return {
            success: false,
            message: "بازی قبلاً شروع شده است."
        };

    }

    if (room.players.size < MIN_PLAYERS) {

        return {
            success: false,
            message:
                "برای شروع بازی حداقل ۲ بازیکن لازم است."
        };

    }

    const players =
        Array.from(room.players.values());

    room.gameStarted = true;

    room.turn = 1;

    room.currentPlayerIndex = 0;

    room.currentPlayerId =
        players[0].id;

    room.dice = null;

    room.lastMove = null;

    room.gameState.finished = false;

    room.updatedAt = Date.now();

    broadcast(room, {

        type: "game_started",

        roomId:
            room.id,

        players:
            getPlayers(room),

        currentPlayerId:
            room.currentPlayerId,

        currentPlayerIndex:
            room.currentPlayerIndex,

        turn:
            room.turn

    });

    sendRoomState(room);

    return {
        success: true
    };

}

// ======================================================
// NEXT TURN
// ======================================================

function nextTurn(room) {

    if (!room) return;

    if (room.players.size === 0) {
        return;
    }

    const players =
        Array.from(room.players.values());

    if (!players.length) {
        return;
    }

    let nextIndex =
        room.currentPlayerIndex;

    for (let i = 0; i < players.length; i++) {

        nextIndex++;

        if (nextIndex >= players.length) {
            nextIndex = 0;
        }

        const candidate =
            players[nextIndex];

        if (
            candidate &&
            !candidate.eliminated &&
            candidate.connected !== false
        ) {

            break;

        }

    }

    room.currentPlayerIndex =
        nextIndex;

    room.currentPlayerId =
        players[nextIndex].id;

    room.turn++;

    room.dice = null;

    room.lastMove = null;

    room.updatedAt = Date.now();

    broadcast(room, {

        type: "turn_changed",

        currentPlayerId:
            room.currentPlayerId,

        currentPlayerIndex:
            room.currentPlayerIndex,

        turn:
            room.turn,

        dice:
            null

    });

}

// ======================================================
// ROLL DICE
// ======================================================

function rollDice(room, playerId) {

    if (!room) {

        return {
            success: false,
            message: "اتاق پیدا نشد."
        };

    }

    if (!room.gameStarted) {

        return {
            success: false,
            message:
                "بازی هنوز شروع نشده است."
        };

    }

    if (
        room.currentPlayerId !==
        playerId
    ) {

        return {
            success: false,
            message:
                "الان نوبت شما نیست."
        };

    }

    if (room.dice !== null) {

        return {
            success: false,
            message:
                "تاس قبلاً ریخته شده است."
        };

    }

    const value =
        Math.floor(
            Math.random() * 6
        ) + 1;

    room.dice = value;

    room.updatedAt =
        Date.now();

    broadcast(room, {

        type: "dice",

        playerId,

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
// MOVE
// ======================================================

function makeMove(
    room,
    playerId,
    moveData
) {

    if (!room) {

        return {
            success: false,
            message:
                "اتاق پیدا نشد."
        };

    }

    if (!room.gameStarted) {

        return {
            success: false,
            message:
                "بازی شروع نشده است."
        };

    }

    if (
        room.currentPlayerId !==
        playerId
    ) {

        return {
            success: false,
            message:
                "الان نوبت شما نیست."
        };

    }

    if (room.dice === null) {

        return {
            success: false,
            message:
                "ابتدا تاس بیندازید."
        };

    }

    const dice =
        room.dice;

    const player =
        room.players.get(playerId);

    if (!player) {

        return {
            success: false,
            message:
                "بازیکن پیدا نشد."
        };

    }

    room.lastMove = {

        playerId,

        dice,

        move:
            moveData || null,

        time:
            Date.now()

    };

    // --------------------------------------------------
    // ذخیره آخرین حرکت
    // --------------------------------------------------

    room.gameState.lastMove =
        room.lastMove;

    room.updatedAt =
        Date.now();

    // --------------------------------------------------
    // ارسال حرکت به همه
    // --------------------------------------------------

    broadcast(room, {

        type: "move",

        playerId,

        dice,

        move:
            moveData || null,

        turn:
            room.turn

    });

    // --------------------------------------------------
    // کنترل نوبت
    // --------------------------------------------------

    let extraTurn = false;

    if (dice === 6) {
        extraTurn = true;
    }

    // --------------------------------------------------
    // اگر حرکت باعث پایان بازی شده
    // --------------------------------------------------

    if (
        moveData &&
        moveData.gameFinished === true
    ) {

        room.gameState.finished = true;

        room.gameStarted = false;

        broadcast(room, {

            type: "game_finished",

            rankings:
                moveData.rankings ||
                [],

            winner:
                moveData.winner ??
                null

        });

        sendRoomState(room);

        return {
            success: true
        };

    }

    // --------------------------------------------------
    // اگر بازیکن شش آورد، نوبت خودش
    // --------------------------------------------------

    if (extraTurn) {

        room.dice = null;

        broadcast(room, {

            type: "extra_turn",

            playerId,

            turn:
                room.turn

        });

        sendRoomState(room);

        return {
            success: true,
            extraTurn: true
        };

    }

    // --------------------------------------------------
    // نفر بعد
    // --------------------------------------------------

    nextTurn(room);

    sendRoomState(room);

    return {
        success: true,
        extraTurn: false
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
            message:
                "اتاق پیدا نشد."
        };

    }

    if (!room.gameStarted) {

        return {
            success: false,
            message:
                "بازی شروع نشده است."
        };

    }

    if (
        room.currentPlayerId !==
        playerId
    ) {

        return {
            success: false,
            message:
                "الان نوبت شما نیست."
        };

    }

    if (!state) {

        return {
            success: false,
            message:
                "وضعیت بازی نامعتبر است."
        };

    }

    room.gameState =
        {

            ...room.gameState,

            ...state,

            lastMove:
                room.gameState.lastMove

        };

    room.updatedAt =
        Date.now();

    broadcastExcept(
        room,
        playerId,
        {

            type: "state_update",

            playerId,

            gameState:
                room.gameState

        }
    );

    return {
        success: true
    };

}

// ======================================================
// CONNECTION
// ======================================================

wss.on(
    "connection",
    (ws) => {

        let currentRoom = null;

        let playerId = null;

        let disconnected = false;

        // ------------------------------------------------
        // CONNECTED
        // ------------------------------------------------

        send(ws, {

            type: "connected",

            message:
                "اتصال به سرور برقرار شد.",

            serverTime:
                Date.now(),

            version:
                "3.0.0"

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

                // ==========================================
                // PING
                // ==========================================

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

                // ==========================================
                // CREATE ROOM
                // ==========================================

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

                    playerId =
                        generatePlayerId();

                    const player = {

                        id:
                            playerId,

                        ws,

                        name:
                            sanitizeName(
                                message.name
                            ) ||
                            "Player 1",

                        color:
                            getPlayerColor(0),

                        ready:
                            false,

                        connected:
                            true,

                        eliminated:
                            false,

                        lastSeen:
                            Date.now()

                    };

                    room.players.set(
                        playerId,
                        player
                    );

                    rooms.set(
                        roomId,
                        room
                    );

                    currentRoom =
                        room;

                    send(ws, {

                        type:
                            "room_created",

                        roomId,

                        playerId,

                        color:
                            player.color

                    });

                    sendRoomState(
                        room
                    );

                    return;

                }

                // ==========================================
                // JOIN ROOM
                // ==========================================

                if (
                    message.type ===
                    "join_room"
                ) {

                    if (currentRoom) {

                        send(ws, {

                            type:
                                "error",

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

                    if (!roomId) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                "کد اتاق وارد نشده است."

                        });

                        return;

                    }

                    const room =
                        rooms.get(
                            roomId
                        );

                    if (!room) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                "اتاق پیدا نشد."

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
                                "بازی این اتاق شروع شده است."

                        });

                        return;

                    }

                    if (
                        room.players.size >=
                        MAX_PLAYERS
                    ) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                "اتاق پر است."

                        });

                        return;

                    }

                    playerId =
                        generatePlayerId();

                    const playerIndex =
                        room.players.size;

                    const player = {

                        id:
                            playerId,

                        ws,

                        name:
                            sanitizeName(
                                message.name
                            ) ||
                            `Player ${playerIndex + 1}`,

                        color:
                            getPlayerColor(
                                playerIndex
                            ),

                        ready:
                            false,

                        connected:
                            true,

                        eliminated:
                            false,

                        lastSeen:
                            Date.now()

                    };

                    room.players.set(
                        playerId,
                        player
                    );

                    room.updatedAt =
                        Date.now();

                    currentRoom =
                        room;

                    send(ws, {

                        type:
                            "joined_room",

                        roomId,

                        playerId,

                        color:
                            player.color

                    });

                    broadcastExcept(
                        room,
                        playerId,
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
                                        playerIndex

                                }

                        }
                    );

                    sendRoomState(
                        room
                    );

                    return;

                }

                // ==========================================
                // RECONNECT
                // ==========================================

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

                    const oldPlayerId =
                        String(
                            message.playerId ||
                            ""
                        );

                    const room =
                        rooms.get(
                            roomId
                        );

                    if (!room) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                "اتاق پیدا نشد."

                        });

                        return;

                    }

                    const player =
                        room.players.get(
                            oldPlayerId
                        );

                    if (!player) {

                        send(ws, {

                            type:
                                "error",

                            message:
                                "بازیکن پیدا نشد."

                        });

                        return;

                    }

                    player.ws =
                        ws;

                    player.connected =
                        true;

                    player.lastSeen =
                        Date.now();

                    playerId =
                        oldPlayerId;

                    currentRoom =
                        room;

                    disconnected =
                        false;

                    send(ws, {

                        type:
                            "reconnected",

                        roomId:
                            room.id,

                        playerId,

                        color:
                            player.color

                    });

                    sendRoomState(
                        room
                    );

                    broadcastExcept(
                        room,
                        playerId,
                        {

                            type:
                                "player_reconnected",

                            playerId

                        }
                    );

                    return;

                }

                // ==========================================
                // SET NAME
                // ==========================================

                if (
                    message.type ===
                    "set_name"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
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
                        currentRoom.players.get(
                            playerId
                        );

                    if (!player) return;

                    player.name =
                        sanitizeName(
                            message.name
                        ) ||
                        player.name;

                    currentRoom.updatedAt =
                        Date.now();

                    sendRoomState(
                        currentRoom
                    );

                    return;

                }

                // ==========================================
                // READY
                // ==========================================

                if (
                    message.type ===
                    "ready"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
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
                        currentRoom.players.get(
                            playerId
                        );

                    if (!player) return;

                    player.ready =
                        message.ready !== false;

                    currentRoom.updatedAt =
                        Date.now();

                    sendRoomState(
                        currentRoom
                    );

                    const readyPlayers =
                        Array.from(
                            currentRoom.players.values()
                        )
                            .filter(
                                p =>
                                    p.ready &&
                                    p.connected !== false
                            );

                    if (
                        readyPlayers.length >=
                        MIN_PLAYERS &&
                        !currentRoom.gameStarted
                    ) {

                        startGame(
                            currentRoom
                        );

                    }

                    return;

                }

                // ==========================================
                // START GAME
                // ==========================================

                if (
                    message.type ===
                    "start_game"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
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
                        startGame(
                            currentRoom
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

                // ==========================================
                // ROLL DICE
                // ==========================================

                if (
                    message.type ===
                    "roll_dice"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
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
                        rollDice(
                            currentRoom,
                            playerId
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

                // ==========================================
                // MOVE
                // ==========================================

                if (
                    message.type ===
                    "move"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
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
                        makeMove(
                            currentRoom,
                            playerId,
                            message.move ||
                            null
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

                // ==========================================
                // STATE UPDATE
                // ==========================================

                if (
                    message.type ===
                    "state_update"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
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
                        updateGameState(
                            currentRoom,
                            playerId,
                            message.gameState ||
                            null
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

                // ==========================================
                // GET STATE
                // ==========================================

                if (
                    message.type ===
                    "get_state"
                ) {

                    if (!currentRoom) {

                        send(ws, {

                            type:
                                "error",

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

                // ==========================================
                // LEAVE
                // ==========================================

                if (
                    message.type ===
                    "leave_room"
                ) {

                    leaveRoom(
                        false
                    );

                    return;

                }

                // ==========================================
                // UNKNOWN
                // ==========================================

                send(ws, {

                    type:
                        "error",

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

                disconnected = true;

                if (
                    currentRoom &&
                    playerId
                ) {

                    const room =
                        currentRoom;

                    const player =
                        room.players.get(
                            playerId
                        );

                    if (player) {

                        player.connected =
                            false;

                        player.lastSeen =
                            Date.now();

                        broadcastExcept(
                            room,
                            playerId,
                            {

                                type:
                                    "player_disconnected",

                                playerId

                            }
                        );

                        sendRoomState(
                            room
                        );

                    }

                }

            }
        );

        // =================================================
        // ERROR
        // =================================================

        ws.on(
            "error",
            (error) => {

                console.error(
                    "WebSocket error:",
                    error.message
                );

            }
        );

        // =================================================
        // LEAVE ROOM
        // =================================================

        function leaveRoom(
            permanent = true
        ) {

            if (
                !currentRoom ||
                !playerId
            ) {

                return;

            }

            const room =
                currentRoom;

            const leavingId =
                playerId;

            const wasCurrent =
                room.currentPlayerId ===
                leavingId;

            if (permanent) {

                room.players.delete(
                    leavingId
                );

            } else {

                const player =
                    room.players.get(
                        leavingId
                    );

                if (player) {

                    player.connected =
                        false;

                }

            }

            if (room.players.size === 0) {

                rooms.delete(
                    room.id
                );

            } else {

                if (wasCurrent) {

                    const players =
                        Array.from(
                            room.players.values()
                        );

                    const available =
                        players.filter(
                            p =>
                                p.connected !== false
                        );

                    if (available.length) {

                        room.currentPlayerIndex =
                            players.indexOf(
                                available[0]
                            );

                        room.currentPlayerId =
                            available[0].id;

                        room.dice =
                            null;

                        room.turn++;

                        broadcast(
                            room,
                            {

                                type:
                                    "turn_changed",

                                currentPlayerId:
                                    room.currentPlayerId,

                                currentPlayerIndex:
                                    room.currentPlayerIndex,

                                turn:
                                    room.turn,

                                dice:
                                    null

                            }
                        );

                    } else {

                        room.currentPlayerId =
                            null;

                    }

                }

                broadcast(
                    room,
                    {

                        type:
                            "player_left",

                        playerId:
                            leavingId,

                        playerCount:
                            room.players.size

                    }
                );

                sendRoomState(
                    room
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
// NAME SANITIZER
// ======================================================

function sanitizeName(name) {

    return String(
        name || ""
    )
        .replace(
            /[\u0000-\u001F\u007F]/g,
            ""
        )
        .trim()
        .substring(
            0,
            20
        );

}

// ======================================================
// CLEAN EMPTY ROOMS
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
                room.players.size === 0 &&
                now - room.createdAt >
                30 * 60 * 1000
            ) {

                rooms.delete(
                    roomId
                );

                console.log(
                    `Deleted empty room: ${roomId}`
                );

            }

        }

    },
    10 * 60 * 1000
);

// ======================================================
// SERVER ERROR
// ======================================================

server.on(
    "error",
    (error) => {

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
            "===================================="
        );

        console.log(
            "LUDO MULTIPLAYER SERVER"
        );

        console.log(
            "Version: 3.0.0"
        );

        console.log(
            `Port: ${PORT}`
        );

        console.log(
            "WebSocket: ENABLED"
        );

        console.log(
            "===================================="
        );

    }
);
