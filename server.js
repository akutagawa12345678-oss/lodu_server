// ======================================================
// LUDO SERVER
// نسخه کامل و آماده جایگزینی server.js
// ======================================================

const http = require("http");
const WebSocket = require("ws");

// ======================================================
// تنظیمات
// ======================================================

const PORT = process.env.PORT || 3000;

const MAX_PLAYERS = 4;

// ======================================================
// HTTP SERVER
// ======================================================

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
    });

    res.end(
        JSON.stringify({
            ok: true,
            service: "ludo-server",
            version: "2.0.0",
            players: getTotalPlayers()
        })
    );
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
        ws.send(JSON.stringify(data));
    }
}

function broadcast(room, data) {
    if (!room) return;

    for (const player of room.players.values()) {
        send(player.ws, data);
    }
}

function broadcastExcept(room, exceptPlayerId, data) {
    if (!room) return;

    for (const player of room.players.values()) {
        if (player.id !== exceptPlayerId) {
            send(player.ws, data);
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
        id = Math.random()
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
            .substring(2, 10) +
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

        // بازیکنی که نوبتش است
        currentPlayerIndex: 0,

        // شماره بازیکن فعلی
        currentPlayerId: null,

        // آخرین تاس
        dice: null,

        // وضعیت بازی
        gameStarted: false,

        // زمان ساخت
        createdAt: Date.now(),

        // اطلاعات بازی
        gameState: {
            turn: 0,
            lastMove: null
        }
    };
}

// ======================================================
// ROOM PLAYERS
// ======================================================

function getPlayers(room) {
    return Array.from(room.players.values()).map((player, index) => ({
        id: player.id,
        index,
        name: player.name || `Player ${index + 1}`,
        color: player.color || getPlayerColor(index),
        ready: !!player.ready
    }));
}

function getPlayerColor(index) {
    const colors = [
        "red",
        "green",
        "yellow",
        "blue"
    ];

    return colors[index] || "red";
}

// ======================================================
// SEND ROOM STATE
// ======================================================

function sendRoomState(room) {
    if (!room) return;

    broadcast(room, {
        type: "room_state",

        roomId: room.id,

        players: getPlayers(room),

        playerCount: room.players.size,

        maxPlayers: MAX_PLAYERS,

        gameStarted: room.gameStarted,

        currentPlayerId: room.currentPlayerId,

        dice: room.dice,

        turn: room.gameState.turn,

        lastMove: room.gameState.lastMove
    });
}

// ======================================================
// START GAME
// ======================================================

function startGame(room) {
    if (!room) return;

    if (room.players.size < 2) {
        return false;
    }

    room.gameStarted = true;

    room.gameState.turn = 1;

    room.gameState.lastMove = null;

    const players = Array.from(room.players.values());

    room.currentPlayerIndex = 0;

    room.currentPlayerId = players[0].id;

    room.dice = null;

    broadcast(room, {
        type: "game_started",

        roomId: room.id,

        currentPlayerId: room.currentPlayerId,

        players: getPlayers(room),

        turn: room.gameState.turn
    });

    return true;
}

// ======================================================
// NEXT TURN
// ======================================================

function nextTurn(room) {
    if (!room || room.players.size === 0) return;

    const players = Array.from(room.players.values());

    if (players.length === 0) return;

    room.currentPlayerIndex++;

    if (room.currentPlayerIndex >= players.length) {
        room.currentPlayerIndex = 0;
    }

    room.currentPlayerId =
        players[room.currentPlayerIndex].id;

    room.gameState.turn++;

    room.dice = null;

    broadcast(room, {
        type: "turn_changed",

        currentPlayerId: room.currentPlayerId,

        turn: room.gameState.turn
    });
}

// ======================================================
// DICE
// ======================================================

function rollDice(room, playerId) {
    if (!room) return;

    if (!room.gameStarted) {
        return {
            success: false,
            message: "بازی هنوز شروع نشده است."
        };
    }

    if (room.currentPlayerId !== playerId) {
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
        Math.floor(Math.random() * 6) + 1;

    room.dice = value;

    broadcast(room, {
        type: "dice",

        playerId,

        value,

        turn: room.gameState.turn
    });

    return {
        success: true,
        value
    };
}

// ======================================================
// MOVE
// ======================================================

function makeMove(room, playerId, moveData) {
    if (!room) return;

    if (!room.gameStarted) {
        return {
            success: false,
            message: "بازی شروع نشده است."
        };
    }

    if (room.currentPlayerId !== playerId) {
        return {
            success: false,
            message: "الان نوبت شما نیست."
        };
    }

    if (room.dice === null) {
        return {
            success: false,
            message: "ابتدا تاس بریزید."
        };
    }

    const diceValue = room.dice;

    room.gameState.lastMove = {
        playerId,
        dice: diceValue,
        move: moveData || null,
        time: Date.now()
    };

    broadcast(room, {
        type: "move",

        playerId,

        dice: diceValue,

        move: moveData || null
    });

    // بعد از حرکت نوبت نفر بعد
    nextTurn(room);

    return {
        success: true
    };
}

// ======================================================
// CONNECTION
// ======================================================

wss.on("connection", (ws, request) => {
    let currentRoom = null;
    let playerId = null;

    // --------------------------------------------------
    // Connected
    // --------------------------------------------------

    send(ws, {
        type: "connected",

        message: "اتصال به سرور برقرار شد.",

        serverTime: Date.now()
    });

    // --------------------------------------------------
    // MESSAGE
    // --------------------------------------------------

    ws.on("message", (raw) => {
        let message;

        try {
            message = JSON.parse(raw.toString());
        } catch (error) {
            send(ws, {
                type: "error",
                message: "پیام نامعتبر است."
            });

            return;
        }

        if (!message || !message.type) {
            send(ws, {
                type: "error",
                message: "نوع پیام مشخص نیست."
            });

            return;
        }

        // ==================================================
        // PING
        // ==================================================

        if (message.type === "ping") {
            send(ws, {
                type: "pong",
                time: Date.now()
            });

            return;
        }

        // ==================================================
        // CREATE ROOM
        // ==================================================

        if (message.type === "create_room") {

            // اگر قبلاً داخل اتاق است
            if (currentRoom) {
                send(ws, {
                    type: "error",
                    message: "شما قبلاً داخل یک اتاق هستید."
                });

                return;
            }

            const roomId = generateRoomId();

            const room = createRoom(roomId);

            playerId = generatePlayerId();

            const player = {
                id: playerId,

                ws,

                name:
                    String(message.name || "")
                        .trim()
                        .substring(0, 20) ||
                    "Player 1",

                color: getPlayerColor(0),

                ready: false
            };

            room.players.set(
                playerId,
                player
            );

            rooms.set(roomId, room);

            currentRoom = room;

            send(ws, {
                type: "room_created",

                roomId,

                playerId,

                color: player.color
            });

            sendRoomState(room);

            return;
        }

        // ==================================================
        // JOIN ROOM
        // ==================================================

        if (message.type === "join_room") {

            if (currentRoom) {
                send(ws, {
                    type: "error",
                    message: "شما قبلاً داخل یک اتاق هستید."
                });

                return;
            }

            const roomId =
                String(message.roomId || "")
                    .trim()
                    .toUpperCase();

            if (!roomId) {
                send(ws, {
                    type: "error",
                    message: "کد اتاق وارد نشده است."
                });

                return;
            }

            const room = rooms.get(roomId);

            if (!room) {
                send(ws, {
                    type: "error",
                    message: "اتاق پیدا نشد."
                });

                return;
            }

            if (room.gameStarted) {
                send(ws, {
                    type: "error",
                    message: "بازی این اتاق شروع شده است."
                });

                return;
            }

            if (room.players.size >= MAX_PLAYERS) {
                send(ws, {
                    type: "error",
                    message: "اتاق پر است."
                });

                return;
            }

            playerId = generatePlayerId();

            const playerIndex =
                room.players.size;

            const player = {
                id: playerId,

                ws,

                name:
                    String(message.name || "")
                        .trim()
                        .substring(0, 20) ||
                    `Player ${playerIndex + 1}`,

                color: getPlayerColor(playerIndex),

                ready: false
            };

            room.players.set(
                playerId,
                player
            );

            currentRoom = room;

            send(ws, {
                type: "joined_room",

                roomId,

                playerId,

                color: player.color
            });

            sendRoomState(room);

            return;
        }

        // ==================================================
        // SET NAME
        // ==================================================

        if (message.type === "set_name") {

            if (!currentRoom || !playerId) {
                send(ws, {
                    type: "error",
                    message: "ابتدا وارد اتاق شوید."
                });

                return;
            }

            const player =
                currentRoom.players.get(playerId);

            if (!player) return;

            player.name =
                String(message.name || "")
                    .trim()
                    .substring(0, 20) ||
                player.name;

            sendRoomState(currentRoom);

            return;
        }

        // ==================================================
        // READY
        // ==================================================

        if (message.type === "ready") {

            if (!currentRoom || !playerId) {
                send(ws, {
                    type: "error",
                    message: "ابتدا وارد اتاق شوید."
                });

                return;
            }

            const player =
                currentRoom.players.get(playerId);

            if (!player) return;

            player.ready = Boolean(
                message.ready !== false
            );

            sendRoomState(currentRoom);

            // اگر حداقل 2 نفر آماده باشند
            const players =
                Array.from(
                    currentRoom.players.values()
                );

            const readyPlayers =
                players.filter(
                    p => p.ready
                );

            if (
                readyPlayers.length >= 2 &&
                !currentRoom.gameStarted
            ) {
                startGame(currentRoom);
            }

            return;
        }

        // ==================================================
        // START GAME
        // ==================================================

        if (message.type === "start_game") {

            if (!currentRoom || !playerId) {
                send(ws, {
                    type: "error",
                    message: "ابتدا وارد اتاق شوید."
                });

                return;
            }

            // فقط وقتی حداقل دو بازیکن هستند
            if (currentRoom.players.size < 2) {
                send(ws, {
                    type: "error",
                    message:
                        "برای شروع بازی حداقل ۲ بازیکن لازم است."
                });

                return;
            }

            if (currentRoom.gameStarted) {
                send(ws, {
                    type: "error",
                    message: "بازی قبلاً شروع شده است."
                });

                return;
            }

            startGame(currentRoom);

            return;
        }

        // ==================================================
        // ROLL DICE
        // ==================================================

        if (message.type === "roll_dice") {

            if (!currentRoom || !playerId) {
                send(ws, {
                    type: "error",
                    message: "ابتدا وارد اتاق شوید."
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
                    type: "error",
                    message: result.message
                });
            }

            return;
        }

        // ==================================================
        // MOVE
        // ==================================================

        if (message.type === "move") {

            if (!currentRoom || !playerId) {
                send(ws, {
                    type: "error",
                    message: "ابتدا وارد اتاق شوید."
                });

                return;
            }

            const result =
                makeMove(
                    currentRoom,
                    playerId,
                    message.move || null
                );

            if (!result.success) {
                send(ws, {
                    type: "error",
                    message: result.message
                });
            }

            return;
        }

        // ==================================================
        // GAME STATE REQUEST
        // ==================================================

        if (message.type === "get_state") {

            if (!currentRoom) {
                send(ws, {
                    type: "error",
                    message: "شما داخل اتاق نیستید."
                });

                return;
            }

            send(ws, {
                type: "room_state",

                roomId: currentRoom.id,

                players:
                    getPlayers(currentRoom),

                playerCount:
                    currentRoom.players.size,

                maxPlayers:
                    MAX_PLAYERS,

                gameStarted:
                    currentRoom.gameStarted,

                currentPlayerId:
                    currentRoom.currentPlayerId,

                dice:
                    currentRoom.dice,

                turn:
                    currentRoom.gameState.turn,

                lastMove:
                    currentRoom.gameState.lastMove
            });

            return;
        }

        // ==================================================
        // LEAVE ROOM
        // ==================================================

        if (message.type === "leave_room") {

            leaveRoom();

            return;
        }

        // ==================================================
        // UNKNOWN MESSAGE
        // ==================================================

        send(ws, {
            type: "error",

            message:
                `نوع پیام "${message.type}" شناخته نشد.`
        });
    });

    // ====================================================
    // CLOSE
    // ====================================================

    ws.on("close", () => {
        leaveRoom();
    });

    // ====================================================
    // ERROR
    // ====================================================

    ws.on("error", (error) => {
        console.error(
            "WebSocket error:",
            error.message
        );
    });

    // ====================================================
    // LEAVE ROOM FUNCTION
    // ====================================================

    function leaveRoom() {

        if (!currentRoom || !playerId) {
            return;
        }

        const room = currentRoom;

        room.players.delete(playerId);

        // اگر بازیکنی که نوبتش بود خارج شد
        if (
            room.currentPlayerId === playerId
        ) {

            const players =
                Array.from(
                    room.players.values()
                );

            if (players.length > 0) {

                room.currentPlayerIndex = 0;

                room.currentPlayerId =
                    players[0].id;

                room.dice = null;

                broadcast(room, {
                    type: "turn_changed",

                    currentPlayerId:
                        room.currentPlayerId,

                    turn:
                        room.gameState.turn
                });
            } else {

                room.currentPlayerId = null;
            }
        }

        // اطلاع به بقیه
        if (room.players.size > 0) {

            broadcast(room, {
                type: "player_left",

                playerId,

                playerCount:
                    room.players.size
            });

            sendRoomState(room);

        } else {

            rooms.delete(room.id);
        }

        currentRoom = null;
        playerId = null;
    }
});

// ======================================================
// ERROR HANDLING
// ======================================================

server.on("error", (error) => {
    console.error(
        "HTTP server error:",
        error
    );
});

// ======================================================
// START SERVER
// ======================================================

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Ludo server running on port ${PORT}`
        );

        console.log(
            `Port: ${PORT}`
        );
    }
);

// ======================================================
// CLEAN EMPTY ROOMS
// ======================================================

setInterval(() => {

    const now = Date.now();

    for (const [roomId, room] of rooms) {

        if (
            room.players.size === 0 &&
            now - room.createdAt > 30 * 60 * 1000
        ) {

            rooms.delete(roomId);

            console.log(
                `Deleted empty room: ${roomId}`
            );
        }
    }

}, 10 * 60 * 1000);
