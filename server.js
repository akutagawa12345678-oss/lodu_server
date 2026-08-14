const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
    res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8"
    });

    res.end(JSON.stringify({
        ok: true,
        service: "ludo-server"
    }));
});

const wss = new WebSocket.Server({ server });

const rooms = new Map();

function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcast(room, data) {
    for (const player of room.players.values()) {
        send(player.ws, data);
    }
}

function createRoom(id) {
    return {
        id,
        players: new Map(),
        currentPlayer: 0,
        dice: null
    };
}

wss.on("connection", (ws) => {
    let currentRoom = null;
    let playerId = null;

    send(ws, {
        type: "connected"
    });

    ws.on("message", (raw) => {
        let message;

        try {
            message = JSON.parse(raw.toString());
        } catch {
            send(ws, {
                type: "error",
                message: "پیام نامعتبر است."
            });
            return;
        }

        if (message.type === "create_room") {
            const roomId = Math.random()
                .toString(36)
                .substring(2, 8)
                .toUpperCase();

            const room = createRoom(roomId);

            playerId = cryptoRandomId();
            room.players.set(playerId, {
                id: playerId,
                ws
            });

            rooms.set(roomId, room);
            currentRoom = room;

            send(ws, {
                type: "room_created",
                roomId,
                playerId
            });

            broadcast(room, {
                type: "players",
                count: room.players.size
            });

            return;
        }

        if (message.type === "join_room") {
            const roomId = String(message.roomId || "")
                .trim()
                .toUpperCase();

            const room = rooms.get(roomId);

            if (!room) {
                send(ws, {
                    type: "error",
                    message: "اتاق پیدا نشد."
                });
                return;
            }

            if (room.players.size >= 4) {
                send(ws, {
                    type: "error",
                    message: "اتاق پر است."
                });
                return;
            }

            playerId = cryptoRandomId();

            room.players.set(playerId, {
                id: playerId,
                ws
            });

            currentRoom = room;

            send(ws, {
                type: "joined_room",
                roomId,
                playerId
            });

            broadcast(room, {
                type: "players",
                count: room.players.size
            });

            return;
        }

        if (message.type === "ping") {
            send(ws, {
                type: "pong"
            });
        }
    });

    ws.on("close", () => {
        if (!currentRoom || !playerId) return;

        currentRoom.players.delete(playerId);

        broadcast(currentRoom, {
            type: "players",
            count: currentRoom.players.size
        });

        if (currentRoom.players.size === 0) {
            rooms.delete(currentRoom.id);
        }
    });
});

function cryptoRandomId() {
    return Math.random()
        .toString(36)
        .substring(2, 10);
}

server.listen(PORT, () => {
    console.log(`Ludo server running on port ${PORT}`);
});
