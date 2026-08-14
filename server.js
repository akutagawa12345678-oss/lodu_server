// ======================================================
// LUDO MULTIPLAYER SERVER
// نسخه چندنفره واقعی
// WebSocket + Server Authoritative State
// ======================================================

const http = require("http");
const WebSocket = require("ws");

// ======================================================
// CONFIG
// ======================================================

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 4;

const COLORS = [
    "red",
    "green",
    "yellow",
    "blue"
];

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

// ------------------------------------------------------

function broadcast(room, data) {

    if (!room) return;

    for (
        const player of room.players.values()
    ) {

        send(
            player.ws,
            data
        );

    }

}

// ------------------------------------------------------

function broadcastExcept(
    room,
    playerId,
    data
) {

    if (!room) return;

    for (
        const player of room.players.values()
    ) {

        if (
            player.id !== playerId
        ) {

            send(
                player.ws,
                data
            );

        }

    }

}

// ------------------------------------------------------

function getTotalPlayers() {

    let total = 0;

    for (
        const room of rooms.values()
    ) {

        total +=
            room.players.size;

    }

    return total;

}

// ------------------------------------------------------

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

// ------------------------------------------------------

function generatePlayerId() {

    return (
        Math.random()
            .toString(36)
            .substring(2, 10)
        +
        Date.now()
            .toString(36)
    );

}

// ======================================================
// ROOM
// ======================================================

function createRoom(id) {

    return {

        id,

        players: new Map(),

        gameStarted: false,

        gameFinished: false,

        currentPlayerIndex: 0,

        currentPlayerId: null,

        dice: null,

        diceLocked: false,

        turn: 0,

        lastMove: null,

        rankings: [],

        createdAt: Date.now(),

        updatedAt: Date.now(),

        // وضعیت اصلی لودو
        gameState: {

            pieces: [],

            captured: [],

            finished: [],

            eliminated: [
                false,
                false,
                false,
                false
            ]

        }

    };

}

// ======================================================
// PLAYER
// ======================================================

function getPlayerColor(index) {

    return (
        COLORS[index] ||
        "red"
    );

}

// ------------------------------------------------------

function getPlayers(room) {

    return Array
        .from(
            room.players.values()
        )
        .map(
            function(player, index) {

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
                        player.ws &&
                        player.ws.readyState ===
                        WebSocket.OPEN

                };

            }
        );

}

// ======================================================
// PUBLIC ROOM STATE
// ======================================================

function getRoomState(room) {

    return {

        type: "room_state",

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

        gameFinished:
            room.gameFinished,

        currentPlayerId:
            room.currentPlayerId,

        dice:
            room.dice,

        diceLocked:
            room.diceLocked,

        turn:
            room.turn,

        rankings:
            room.rankings,

        lastMove:
            room.lastMove,

        gameState:
            room.gameState

    };

}

// ------------------------------------------------------

function sendRoomState(room) {

    if (!room) return;

    broadcast(
        room,
        getRoomState(room)
    );

}

// ======================================================
// INITIAL GAME STATE
// ======================================================

function createInitialGameState(room) {

    room.gameState = {

        pieces:
            getPlayers(room).map(
                function(player) {

                    return {

                        playerId:
                            player.id,

                        color:
                            player.color,

                        pieces: [
                            {
                                progress: -1
                            },
                            {
                                progress: -1
                            },
                            {
                                progress: -1
                            },
                            {
                                progress: -1
                            }
                        ]

                    };

                }
            ),

        captured: [],

        finished: [],

        eliminated: [
            false,
            false,
            false,
            false
        ]

    };

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

    room.gameStarted = true;

    room.gameFinished = false;

    room.turn = 1;

    room.currentPlayerIndex = 0;

    room.rankings = [];

    room.dice = null;

    room.diceLocked = false;

    room.lastMove = null;

    createInitialGameState(room);

    const players =
        Array.from(
            room.players.values()
        );

    room.currentPlayerId =
        players[0].id;

    broadcast(
        room,
        {

            type:
                "game_started",

            roomId:
                room.id,

            players:
                getPlayers(room),

            currentPlayerId:
                room.currentPlayerId,

            turn:
                room.turn,

            gameState:
                room.gameState

        }
    );

    return true;

}

// ======================================================
// NEXT TURN
// ======================================================

function nextTurn(room) {

    if (!room) return;

    if (
        room.gameFinished
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

        room.currentPlayerIndex = 0;

    }

    room.currentPlayerId =
        players[
            room.currentPlayerIndex
        ].id;

    room.turn++;

    room.dice = null;

    room.diceLocked = false;

    room.lastMove = null;

    room.updatedAt =
        Date.now();

    broadcast(
        room,
        {

            type:
                "turn_changed",

            currentPlayerId:
                room.currentPlayerId,

            turn:
                room.turn,

            dice:
                null,

            diceLocked:
                false

        }
    );

}

// ======================================================
// DICE
// ======================================================

function rollDice(
    room,
    playerId
) {

    if (!room) {

        return {
            success: false,
            message: "اتاق پیدا نشد."
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
        room.gameFinished
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

    room.diceLocked =
        true;

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
                room.turn

        }
    );

    return {

        success: true,

        value

    };

}

// ======================================================
// MOVE VALIDATION
// ======================================================

function validateMove(
    room,
    playerId,
    move
) {

    if (!move) {

        return {
            valid: false,
            message:
                "اطلاعات حرکت ارسال نشده است."
        };

    }

    if (
        room.currentPlayerId !==
        playerId
    ) {

        return {
            valid: false,
            message:
                "الان نوبت شما نیست."
        };

    }

    if (
        room.dice === null
    ) {

        return {
            valid: false,
            message:
                "ابتدا تاس بریزید."
        };

    }

    const pieceIndex =
        Number(
            move.pieceIndex
        );

    if (
        !Number.isInteger(
            pieceIndex
        ) ||
        pieceIndex < 0 ||
        pieceIndex > 3
    ) {

        return {
            valid: false,
            message:
                "مهره نامعتبر است."
        };

    }

    return {
        valid: true
    };

}

// ======================================================
// MOVE
// ======================================================

function makeMove(
    room,
    playerId,
    move
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
        room.gameFinished
    ) {

        return {
            success: false,
            message:
                "بازی تمام شده است."
        };

    }

    const validation =
        validateMove(
            room,
            playerId,
            move
        );

    if (
        !validation.valid
    ) {

        return {

            success: false,

            message:
                validation.message

        };

    }

    const dice =
        room.dice;

    const playerIndex =
        room.currentPlayerIndex;

    const playerState =
        room.gameState
            .pieces[playerIndex];

    if (!playerState) {

        return {

            success: false,

            message:
                "وضعیت بازیکن پیدا نشد."

        };

    }

    const piece =
        playerState.pieces[
            move.pieceIndex
        ];

    if (!piece) {

        return {

            success: false,

            message:
                "مهره پیدا نشد."

        };

    }

    const oldProgress =
        Number(
            piece.progress
        );

    let newProgress =
        oldProgress;

    // --------------------------------------------------
    // خروج از خانه
    // --------------------------------------------------

    if (
        oldProgress === -1
    ) {

        if (
            dice !== 6
        ) {

            return {

                success: false,

                message:
                    "برای خارج کردن مهره باید ۶ بیاورید."

            };

        }

        newProgress = 0;

    }

    // --------------------------------------------------
    // حرکت عادی
    // --------------------------------------------------

    else {

        newProgress =
            oldProgress + dice;

    }

    // --------------------------------------------------
    // بیشتر از خانه نهایی
    // --------------------------------------------------

    if (
        newProgress > 58
    ) {

        return {

            success: false,

            message:
                "این مهره با این تاس قابل حرکت نیست."

        };

    }

    piece.progress =
        newProgress;

    room.lastMove = {

        playerId,

        playerIndex,

        pieceIndex:
            move.pieceIndex,

        oldProgress,

        newProgress,

        dice,

        time:
            Date.now()

    };

    // ==================================================
    // CAPTURE
    // ==================================================

    let captured = [];

    if (
        newProgress >= 0 &&
        newProgress < 52
    ) {

        const captureData =
            captureOpponents(
                room,
                playerIndex,
                newProgress
            );

        captured =
            captureData;

    }

    // ==================================================
    // FINISH PIECE
    // ==================================================

    if (
        newProgress === 58
    ) {

        if (
            !room.gameState
                .finished
                .includes(playerIndex)
        ) {

            room.gameState
                .finished
                .push(
                    playerIndex
                );

        }

    }

    room.updatedAt =
        Date.now();

    broadcast(
        room,
        {

            type:
                "move",

            playerId,

            playerIndex,

            pieceIndex:
                move.pieceIndex,

            oldProgress,

            newProgress,

            dice,

            captured,

            turn:
                room.turn,

            gameState:
                room.gameState

        }
    );

    // ==================================================
    // PLAYER FINISHED
    // ==================================================

    checkPlayerFinished(
        room,
        playerIndex
    );

    // ==================================================
    // NEXT TURN
    // ==================================================

    if (
        !room.gameFinished
    ) {

        nextTurn(
            room
        );

    }

    return {

        success: true

    };

}

// ======================================================
// CAPTURE
// ======================================================

function captureOpponents(
    room,
    playerIndex,
    progress
) {

    const captured = [];

    if (
        progress < 0 ||
        progress >= 52
    ) {

        return captured;

    }

    for (
        let i = 0;
        i < room.gameState.pieces.length;
        i++
    ) {

        if (
            i === playerIndex
        ) {

            continue;

        }

        const opponent =
            room.gameState
                .pieces[i];

        if (!opponent) continue;

        for (
            let j = 0;
            j < opponent.pieces.length;
            j++
        ) {

            const piece =
                opponent.pieces[j];

            if (!piece) continue;

            if (
                piece.progress === progress
            ) {

                piece.progress =
                    -1;

                captured.push({

                    playerIndex:
                        i,

                    pieceIndex:
                        j

                });

            }

        }

    }

    return captured;

}

// ======================================================
// PLAYER FINISHED
// ======================================================

function checkPlayerFinished(
    room,
    playerIndex
) {

    const player =
        room.gameState
            .pieces[playerIndex];

    if (!player) return;

    const finished =
        player.pieces.every(
            function(piece) {

                return (
                    piece.progress === 58
                );

            }
        );

    if (!finished) {

        return;

    }

    if (
        room.rankings.includes(
            playerIndex
        )
    ) {

        return;

    }

    room.rankings.push(
        playerIndex
    );

    room.gameState
        .eliminated[playerIndex] =
        true;

    broadcast(
        room,
        {

            type:
                "player_finished",

            playerIndex,

            rank:
                room.rankings.length,

            rankings:
                room.rankings

        }
    );

    const active =
        getActivePlayerIndexes(
            room
        );

    if (
        active.length <= 1
    ) {

        if (
            active.length === 1
        ) {

            const last =
                active[0];

            if (
                !room.rankings
                    .includes(last)
            ) {

                room.rankings.push(
                    last
                );

            }

        }

        room.gameFinished =
            true;

        room.dice =
            null;

        room.diceLocked =
            false;

        broadcast(
            room,
            {

                type:
                    "game_finished",

                rankings:
                    room.rankings,

                gameState:
                    room.gameState

            }
        );

    }

}

// ======================================================
// ACTIVE PLAYERS
// ======================================================

function getActivePlayerIndexes(
    room
) {

    const result = [];

    for (
        let i = 0;
        i < room.gameState
            .pieces.length;
        i++
    ) {

        if (
            !room.gameState
                .eliminated[i]
        ) {

            result.push(i);

        }

    }

    return result;

}

// ======================================================
// GET STATE
// ======================================================

function sendFullState(
    ws,
    room
) {

    send(
        ws,
        getRoomState(room)
    );

}

// ======================================================
// CONNECTION
// ======================================================

wss.on(
    "connection",
    function(ws) {

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
                    Date.now()

            }
        );

        // ==================================================
        // MESSAGE
        // ==================================================

        ws.on(
            "message",
            function(raw) {

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

                    if (
                        currentRoom
                    ) {

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
                                message.name ||
                                ""
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
                            false

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

                    if (
                        currentRoom
                    ) {

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
                                message.name ||
                                ""
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
                            false

                    };

                    room.players.set(
                        playerId,
                        player
                    );

                    room.updatedAt =
                        Date.now();

                    currentRoom =
                        room;

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
                        currentRoom
                            .players
                            .get(
                                playerId
                            );

                    if (!player) return;

                    player.name =
                        String(
                            message.name ||
                            ""
                        )
                            .trim()
                            .substring(
                                0,
                                20
                            ) ||
                        player.name;

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

                    const player =
                        currentRoom
                            .players
                            .get(
                                playerId
                            );

                    if (!player) return;

                    player.ready =
                        message.ready !== false;

                    sendRoomState(
                        currentRoom
                    );

                    const readyPlayers =
                        Array
                            .from(
                                currentRoom
                                    .players
                                    .values()
                            )
                            .filter(
                                function(p) {

                                    return p.ready;

                                }
                            );

                    if (
                        readyPlayers.length >= 2 &&
                        !currentRoom.gameStarted
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
                                    "حداقل ۲ بازیکن لازم است."

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

                    sendFullState(
                        ws,
                        currentRoom
                    );

                    return;

                }

                // ==================================================
                // LEAVE
                // ==================================================

                if (
                    message.type ===
                    "leave_room"
                ) {

                    leaveRoom();

                    return;

                }

                // ==================================================
                // UNKNOWN
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
            function() {

                leaveRoom();

            }
        );

        // ==================================================
        // ERROR
        // ==================================================

        ws.on(
            "error",
            function(error) {

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

            const leavingPlayer =
                playerId;

            room.players.delete(
                leavingPlayer
            );

            // ------------------------------------------------
            // اگر اتاق خالی شد
            // ------------------------------------------------

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

            // ------------------------------------------------
            // اگر بازی در حال اجرا بود
            // ------------------------------------------------

            if (
                room.gameStarted
            ) {

                const players =
                    Array.from(
                        room.players.values()
                    );

                // اگر بازیکن فعلی خارج شد
                if (
                    room.currentPlayerId ===
                    leavingPlayer
                ) {

                    room.currentPlayerIndex = 0;

                    room.currentPlayerId =
                        players[0].id;

                    room.dice =
                        null;

                    room.diceLocked =
                        false;

                    room.turn++;

                    broadcast(
                        room,
                        {

                            type:
                                "turn_changed",

                            currentPlayerId:
                                room.currentPlayerId,

                            turn:
                                room.turn,

                            dice:
                                null

                        }
                    );

                }

            }

            // ------------------------------------------------
            // اطلاع خروج
            // ------------------------------------------------

            broadcast(
                room,
                {

                    type:
                        "player_left",

                    playerId:
                        leavingPlayer,

                    playerCount:
                        room.players.size

                }
            );

            sendRoomState(
                room
            );

            room.updatedAt =
                Date.now();

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
    function(error) {

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
    function() {

        console.log(
            "======================================"
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
            "======================================"
        );

    }
);

// ======================================================
// KEEP ALIVE
// ======================================================

setInterval(
    function() {

        const now =
            Date.now();

        for (
            const room of rooms.values()
        ) {

            // حذف اتاق‌های خالی قدیمی
            if (
                room.players.size === 0 &&
                now - room.updatedAt >
                30 * 60 * 1000
            ) {

                rooms.delete(
                    room.id
                );

                continue;

            }

            // Ping بازیکنان
            for (
                const player of room.players.values()
            ) {

                if (
                    player.ws &&
                    player.ws.readyState ===
                    WebSocket.OPEN
                ) {

                    send(
                        player.ws,
                        {

                            type:
                                "server_ping",

                            time:
                                now

                        }
                    );

                }

            }

        }

    },
    30000
);
