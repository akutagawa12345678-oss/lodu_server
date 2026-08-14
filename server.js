// ======================================================
// LUDO MULTIPLAYER SERVER
// نسخه 3.0.0
// WebSocket + Room + Full Game State Sync
// ======================================================

const http = require("http");
const WebSocket = require("ws");

// ======================================================
// SETTINGS
// ======================================================

const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 4;

const ROOM_EMPTY_TIMEOUT = 30 * 60 * 1000;

// ======================================================
// HTTP SERVER
// ======================================================

const server = http.createServer((req, res) => {

    res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
    });

    if (req.method === "OPTIONS") {
        res.end();
        return;
    }

    res.end(
        JSON.stringify({
            ok: true,
            service: "ludo-server",
            version: "3.0.0",
            players: getTotalPlayers(),
            rooms: rooms.size
        })
    );

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
// HELPERS
// ======================================================

function send(ws, data) {

    if (!ws) return;

    if (ws.readyState === WebSocket.OPEN) {

        try {

            ws.send(
                JSON.stringify(data)
            );

        } catch (error) {

            console.error(
                "Send error:",
                error.message
            );

        }

    }

}

function broadcast(room, data) {

    if (!room) return;

    for (const player of room.players.values()) {

        send(
            player.ws,
            data
        );

    }

}

function broadcastExcept(
    room,
    exceptPlayerId,
    data
) {

    if (!room) return;

    for (const player of room.players.values()) {

        if (
            player.id !==
            exceptPlayerId
        ) {

            send(
                player.ws,
                data
            );

        }

    }

}

function getTotalPlayers() {

    let total = 0;

    for (const room of rooms.values()) {

        total += room.players.size;

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

    } while (
        rooms.has(id)
    );

    return id;

}

function generatePlayerId() {

    return (
        Math.random()
            .toString(36)
            .substring(2, 10) +

        Date.now()
            .toString(36)
    );

}

function getPlayerColor(index) {

    const colors = [
        "red",
        "green",
        "yellow",
        "blue"
    ];

    return (
        colors[index] ||
        "red"
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

        createdAt: Date.now(),

        updatedAt: Date.now(),

        // ==================================================
        // SERVER GAME STATE
        // ==================================================

        gameState: {

            turn: 0,

            lastMove: null,

            lastDice: null,

            // وضعیت کامل بازی کلاینت
            clientState: null,

            // رتبه‌بندی
            rankings: [],

            // بازیکنان حذف شده
            eliminated: [
                false,
                false,
                false,
                false
            ],

            // پایان بازی
            gameFinished: false

        }

    };

}

// ======================================================
// ROOM PLAYERS
// ======================================================

function getPlayers(room) {

    return Array
        .from(
            room.players.values()
        )
        .map(
            function(
                player,
                index
            ) {

                return {

                    id:
                        player.id,

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

            }
        );

}

// ======================================================
// FULL ROOM STATE
// ======================================================

function getRoomState(room) {

    if (!room) return null;

    return {

        roomId:
            room.id,

        players:
            getPlayers(room),

        playerCount:
            room.players.size,

        maxPlayers:
            MAX_PLAYERS,

        gameStarted:
            room.gameStarted,

        currentPlayerId:
            room.currentPlayerId,

        currentPlayerIndex:
            room.currentPlayerIndex,

        dice:
            room.dice,

        turn:
            room.gameState.turn,

        lastMove:
            room.gameState.lastMove,

        lastDice:
            room.gameState.lastDice,

        rankings:
            room.gameState.rankings,

        eliminated:
            room.gameState.eliminated,

        gameFinished:
            room.gameState.gameFinished,

        clientState:
            room.gameState.clientState

    };

}

// ======================================================
// SEND ROOM STATE
// ======================================================

function sendRoomState(room) {

    if (!room) return;

    broadcast(
        room,
        {
            type:
                "room_state",

            ...getRoomState(room)
        }
    );

}

// ======================================================
// SEND STATE TO ONE PLAYER
// ======================================================

function sendStateToPlayer(
    room,
    playerId
) {

    if (!room) return;

    const player =
        room.players.get(
            playerId
        );

    if (!player) return;

    send(
        player.ws,
        {
            type:
                "room_state",

            ...getRoomState(room)
        }
    );

}

// ======================================================
// START GAME
// ======================================================

function startGame(room) {

    if (!room) {

        return false;

    }

    if (
        room.players.size < 2
    ) {

        return false;

    }

    if (
        room.gameStarted
    ) {

        return false;

    }

    room.gameStarted =
        true;

    room.gameState.turn =
        1;

    room.gameState.lastMove =
        null;

    room.gameState.lastDice =
        null;

    room.gameState.rankings =
        [];

    room.gameState.eliminated =
        [
            false,
            false,
            false,
            false
        ];

    room.gameState.gameFinished =
        false;

    room.gameState.clientState =
        null;

    const players =
        Array.from(
            room.players.values()
        );

    room.currentPlayerIndex =
        0;

    room.currentPlayerId =
        players[0].id;

    room.dice =
        null;

    room.updatedAt =
        Date.now();

    broadcast(
        room,
        {

            type:
                "game_started",

            roomId:
                room.id,

            currentPlayerId:
                room.currentPlayerId,

            currentPlayerIndex:
                room.currentPlayerIndex,

            players:
                getPlayers(room),

            turn:
                room.gameState.turn

        }
    );

    sendRoomState(room);

    return true;

}

// ======================================================
// NEXT TURN
// ======================================================

function nextTurn(room) {

    if (!room) return;

    if (
        room.players.size === 0
    ) {

        return;

    }

    const players =
        Array.from(
            room.players.values()
        );

    if (
        players.length === 0
    ) {

        return;

    }

    room.currentPlayerIndex++;

    if (
        room.currentPlayerIndex >=
        players.length
    ) {

        room.currentPlayerIndex =
            0;

    }

    room.currentPlayerId =
        players[
            room.currentPlayerIndex
        ].id;

    room.gameState.turn++;

    room.dice =
        null;

    room.gameState.lastDice =
        null;

    room.updatedAt =
        Date.now();

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
                room.gameState.turn,

            dice:
                null

        }
    );

}

// ======================================================
// ROLL DICE
// ======================================================

function rollDice(
    room,
    playerId
) {

    if (!room) {

        return {
            success: false,
            message:
                "اتاق پیدا نشد."
        };

    }

    if (
        !room.gameStarted
    ) {

        return {
            success: false,
            message:
                "بازی هنوز شروع نشده است."
        };

    }

    if (
        room.gameState.gameFinished
    ) {

        return {
            success: false,
            message:
                "بازی تمام شده است."
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

    if (
        room.dice !== null
    ) {

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

    room.dice =
        value;

    room.gameState.lastDice =
        {
            playerId,
            value,
            turn:
                room.gameState.turn,
            time:
                Date.now()
        };

    room.updatedAt =
        Date.now();

    broadcast(
        room,
        {

            type:
                "dice",

            playerId,

            value,

            turn:
                room.gameState.turn

        }
    );

    return {

        success:
            true,

        value

    };

}

// ======================================================
// UPDATE CLIENT GAME STATE
// ======================================================

function updateClientState(
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

    if (
        !state ||
        typeof state !== "object"
    ) {

        return {
            success: false,
            message:
                "وضعیت بازی نامعتبر است."
        };

    }

    room.gameState.clientState =
        state;

    if (
        Array.isArray(
            state.rankings
        )
    ) {

        room.gameState.rankings =
            state.rankings;

    }

    if (
        Array.isArray(
            state.eliminated
        )
    ) {

        room.gameState.eliminated =
            state.eliminated;

    }

    if (
        typeof state.gameFinished ===
        "boolean"
    ) {

        room.gameState.gameFinished =
            state.gameFinished;

    }

    room.updatedAt =
        Date.now();

    broadcast(
        room,
        {

            type:
                "state_sync",

            playerId,

            state:
                room.gameState.clientState,

            rankings:
                room.gameState.rankings,

            eliminated:
                room.gameState.eliminated,

            gameFinished:
                room.gameState.gameFinished,

            turn:
                room.gameState.turn,

            currentPlayerId:
                room.currentPlayerId

        }
    );

    return {
        success: true
    };

}

// ======================================================
// MAKE MOVE
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

    if (
        !room.gameStarted
    ) {

        return {
            success: false,
            message:
                "بازی شروع نشده است."
        };

    }

    if (
        room.gameState.gameFinished
    ) {

        return {
            success: false,
            message:
                "بازی تمام شده است."
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

    if (
        room.dice === null
    ) {

        return {
            success: false,
            message:
                "ابتدا تاس بریزید."
        };

    }

    const diceValue =
        room.dice;

    room.gameState.lastMove =
        {

            playerId,

            dice:
                diceValue,

            move:
                moveData || null,

            time:
                Date.now()

        };

    room.updatedAt =
        Date.now();

    broadcast(
        room,
        {

            type:
                "move",

            playerId,

            dice:
                diceValue,

            move:
                moveData || null,

            turn:
                room.gameState.turn

        }
    );

    return {
        success: true
    };

}

// ======================================================
// FINISH TURN
// ======================================================

function finishTurn(
    room,
    playerId,
    keepTurn
) {

    if (!room) {

        return {
            success: false,
            message:
                "اتاق پیدا نشد."
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

    if (
        room.dice === null
    ) {

        return {
            success: false,
            message:
                "تاسی برای این نوبت وجود ندارد."
        };

    }

    // اگر بازی تمام شده
    if (
        room.gameState.gameFinished
    ) {

        room.dice =
            null;

        broadcast(
            room,
            {
                type:
                    "game_finished",

                rankings:
                    room.gameState.rankings
            }
        );

        return {
            success: true
        };

    }

    // عدد ۶ یا شرایط مشابه:
    // بازیکن می‌تواند نوبتش را نگه دارد.
    if (keepTurn === true) {

        room.dice =
            null;

        room.gameState.lastDice =
            null;

        room.updatedAt =
            Date.now();

        broadcast(
            room,
            {

                type:
                    "turn_kept",

                playerId,

                turn:
                    room.gameState.turn

            }
        );

        return {
            success: true
        };

    }

    nextTurn(room);

    return {
        success: true
    };

}

// ======================================================
// RANKING UPDATE
// ======================================================

function updateRanking(
    room,
    playerId,
    rankings,
    eliminated
) {

    if (!room) return;

    if (
        room.currentPlayerId !==
        playerId
    ) {

        return;

    }

    if (
        Array.isArray(rankings)
    ) {

        room.gameState.rankings =
            rankings;

    }

    if (
        Array.isArray(eliminated)
    ) {

        room.gameState.eliminated =
            eliminated;

    }

    room.updatedAt =
        Date.now();

    broadcast(
        room,
        {

            type:
                "ranking_update",

            rankings:
                room.gameState.rankings,

            eliminated:
                room.gameState.eliminated

        }
    );

}

// ======================================================
// CONNECTION
// ======================================================

wss.on(
    "connection",
    (ws) => {

        let currentRoom =
            null;

        let playerId =
            null;

        // ==================================================
        // CONNECTED
        // ==================================================

        send(
            ws,
            {

                type:
                    "connected",

                message:
                    "اتصال به سرور برقرار شد.",

                serverTime:
                    Date.now(),

                version:
                    "3.0.0"

            }
        );

        // ==================================================
        // MESSAGE
        // ==================================================

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

                    send(
                        ws,
                        {

                            type:
                                "error",

                            message:
                                "پیام نامعتبر است."

                        }
                    );

                    return;

                }

                if (
                    !message ||
                    !message.type
                ) {

                    send(
                        ws,
                        {

                            type:
                                "error",

                            message:
                                "نوع پیام مشخص نیست."

                        }
                    );

                    return;

                }

                // ==================================================
                // PING
                // ==================================================

                if (
                    message.type ===
                    "ping"
                ) {

                    send(
                        ws,
                        {

                            type:
                                "pong",

                            time:
                                Date.now()

                        }
                    );

                    return;

                }

                // ==================================================
                // CREATE ROOM
                // ==================================================

                if (
                    message.type ===
                    "create_room"
                ) {

                    if (currentRoom) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "شما قبلاً داخل یک اتاق هستید."

                            }
                        );

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
                            String(
                                message.name || ""
                            )
                                .trim()
                                .substring(
                                    0,
                                    20
                                ) ||
                            "Player 1",

                        color:
                            getPlayerColor(
                                0
                            ),

                        ready:
                            false,

                        connected:
                            true,

                        joinedAt:
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

                    send(
                        ws,
                        {

                            type:
                                "room_created",

                            roomId,

                            playerId,

                            color:
                                player.color

                        }
                    );

                    sendRoomState(
                        room
                    );

                    return;

                }

                // ==================================================
                // JOIN ROOM
                // ==================================================

                if (
                    message.type ===
                    "join_room"
                ) {

                    if (currentRoom) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "شما قبلاً داخل یک اتاق هستید."

                            }
                        );

                        return;

                    }

                    const roomId =
                        String(
                            message.roomId || ""
                        )
                            .trim()
                            .toUpperCase();

                    if (!roomId) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "کد اتاق وارد نشده است."

                            }
                        );

                        return;

                    }

                    const room =
                        rooms.get(
                            roomId
                        );

                    if (!room) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "اتاق پیدا نشد."

                            }
                        );

                        return;

                    }

                    if (
                        room.gameStarted
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "بازی این اتاق شروع شده است."

                            }
                        );

                        return;

                    }

                    if (
                        room.players.size >=
                        MAX_PLAYERS
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "اتاق پر است."

                            }
                        );

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
                            String(
                                message.name || ""
                            )
                                .trim()
                                .substring(
                                    0,
                                    20
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

                        joinedAt:
                            Date.now()

                    };

                    room.players.set(
                        playerId,
                        player
                    );

                    currentRoom =
                        room;

                    room.updatedAt =
                        Date.now();

                    send(
                        ws,
                        {

                            type:
                                "joined_room",

                            roomId,

                            playerId,

                            color:
                                player.color

                        }
                    );

                    sendRoomState(
                        room
                    );

                    return;

                }

                // ==================================================
                // SET NAME
                // ==================================================

                if (
                    message.type ===
                    "set_name"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "ابتدا وارد اتاق شوید."

                            }
                        );

                        return;

                    }

                    const player =
                        currentRoom.players.get(
                            playerId
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
                            ) ||
                        player.name;

                    currentRoom.updatedAt =
                        Date.now();

                    sendRoomState(
                        currentRoom
                    );

                    return;

                }

                // ==================================================
                // READY
                // ==================================================

                if (
                    message.type ===
                    "ready"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "ابتدا وارد اتاق شوید."

                            }
                        );

                        return;

                    }

                    if (
                        currentRoom.gameStarted
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "بازی قبلاً شروع شده است."

                            }
                        );

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

                    const players =
                        Array.from(
                            currentRoom.players.values()
                        );

                    const readyPlayers =
                        players.filter(
                            function(p) {
                                return p.ready;
                            }
                        );

                    if (
                        readyPlayers.length >= 2
                    ) {

                        startGame(
                            currentRoom
                        );

                    }

                    return;

                }

                // ==================================================
                // START GAME
                // ==================================================

                if (
                    message.type ===
                    "start_game"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "ابتدا وارد اتاق شوید."

                            }
                        );

                        return;

                    }

                    if (
                        currentRoom.players.size <
                        2
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "برای شروع بازی حداقل ۲ بازیکن لازم است."

                            }
                        );

                        return;

                    }

                    if (
                        currentRoom.gameStarted
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "بازی قبلاً شروع شده است."

                            }
                        );

                        return;

                    }

                    startGame(
                        currentRoom
                    );

                    return;

                }

                // ==================================================
                // ROLL DICE
                // ==================================================

                if (
                    message.type ===
                    "roll_dice"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "ابتدا وارد اتاق شوید."

                            }
                        );

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

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    result.message

                            }
                        );

                    }

                    return;

                }

                // ==================================================
                // MOVE
                // ==================================================

                if (
                    message.type ===
                    "move"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "ابتدا وارد اتاق شوید."

                            }
                        );

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

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    result.message

                            }
                        );

                    }

                    return;

                }

                // ==================================================
                // UPDATE STATE
                // ==================================================

                if (
                    message.type ===
                    "update_state"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "ابتدا وارد اتاق شوید."

                            }
                        );

                        return;

                    }

                    const result =
                        updateClientState(
                            currentRoom,
                            playerId,
                            message.state
                        );

                    if (
                        !result.success
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    result.message

                            }
                        );

                    }

                    return;

                }

                // ==================================================
                // FINISH TURN
                // ==================================================

                if (
                    message.type ===
                    "finish_turn"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "ابتدا وارد اتاق شوید."

                            }
                        );

                        return;

                    }

                    const result =
                        finishTurn(
                            currentRoom,
                            playerId,
                            message.keepTurn === true
                        );

                    if (
                        !result.success
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    result.message

                            }
                        );

                    }

                    return;

                }

                // ==================================================
                // RANKING
                // ==================================================

                if (
                    message.type ===
                    "ranking_update"
                ) {

                    if (
                        !currentRoom ||
                        !playerId
                    ) {

                        return;

                    }

                    updateRanking(
                        currentRoom,
                        playerId,
                        message.rankings,
                        message.eliminated
                    );

                    return;

                }

                // ==================================================
                // GAME FINISHED
                // ==================================================

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

                    if (
                        currentRoom.currentPlayerId !==
                        playerId
                    ) {

                        return;

                    }

                    currentRoom.gameState.gameFinished =
                        true;

                    if (
                        Array.isArray(
                            message.rankings
                        )
                    ) {

                        currentRoom.gameState.rankings =
                            message.rankings;

                    }

                    currentRoom.dice =
                        null;

                    currentRoom.updatedAt =
                        Date.now();

                    broadcast(
                        currentRoom,
                        {

                            type:
                                "game_finished",

                            rankings:
                                currentRoom.gameState.rankings,

                            state:
                                currentRoom.gameState.clientState

                        }
                    );

                    return;

                }

                // ==================================================
                // GET STATE
                // ==================================================

                if (
                    message.type ===
                    "get_state"
                ) {

                    if (
                        !currentRoom
                    ) {

                        send(
                            ws,
                            {

                                type:
                                    "error",

                                message:
                                    "شما داخل اتاق نیستید."

                            }
                        );

                        return;

                    }

                    sendStateToPlayer(
                        currentRoom,
                        playerId
                    );

                    return;

                }

                // ==================================================
                // LEAVE ROOM
                // ==================================================

                if (
                    message.type ===
                    "leave_room"
                ) {

                    leaveRoom();

                    return;

                }

                // ==================================================
                // UNKNOWN MESSAGE
                // ==================================================

                send(
                    ws,
                    {

                        type:
                            "error",

                        message:
                            `نوع پیام "${message.type}" شناخته نشد.`

                    }
                );

            }
        );

        // ==================================================
        // CLOSE
        // ==================================================

        ws.on(
            "close",
            () => {

                leaveRoom();

            }
        );

        // ==================================================
        // ERROR
        // ==================================================

        ws.on(
            "error",
            (error) => {

                console.error(
                    "WebSocket error:",
                    error.message
                );

            }
        );

        // ==================================================
        // LEAVE ROOM
        // ==================================================

        function leaveRoom() {

            if (
                !currentRoom ||
                !playerId
            ) {

                return;

            }

            const room =
                currentRoom;

            const leavingPlayerId =
                playerId;

            room.players.delete(
                leavingPlayerId
            );

            room.updatedAt =
                Date.now();

            // ----------------------------------------------
            // اگر اتاق خالی شد
            // ----------------------------------------------

            if (
                room.players.size === 0
            ) {

                rooms.delete(
                    room.id
                );

                currentRoom =
                    null;

                playerId =
                    null;

                return;

            }

            // ----------------------------------------------
            // اگر بازیکن نوبت‌دار خارج شد
            // ----------------------------------------------

            if (
                room.currentPlayerId ===
                leavingPlayerId
            ) {

                const players =
                    Array.from(
                        room.players.values()
                    );

                room.currentPlayerIndex =
                    0;

                room.currentPlayerId =
                    players[0].id;

                room.dice =
                    null;

                room.gameState.turn++;

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
                            room.gameState.turn,

                        dice:
                            null

                    }
                );

            }

            // ----------------------------------------------
            // اطلاع خروج
            // ----------------------------------------------

            broadcast(
                room,
                {

                    type:
                        "player_left",

                    playerId:
                        leavingPlayerId,

                    playerCount:
                        room.players.size

                }
            );

            sendRoomState(
                room
            );

            currentRoom =
                null;

            playerId =
                null;

        }

    }
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
            "========================================"
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
            "========================================"
        );

    }
);

// ======================================================
// CLEAN EMPTY ROOMS
// ======================================================

setInterval(
    () => {

        const now =
            Date.now();

        for (
            const [
                roomId,
                room
            ] of rooms
        ) {

            if (
                room.players.size === 0 &&
                now -
                room.createdAt >
                ROOM_EMPTY_TIMEOUT
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
