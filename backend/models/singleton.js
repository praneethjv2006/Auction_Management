class AuctionSystem {
  static instance = null;

  constructor() {
    if (AuctionSystem.instance) {
      return AuctionSystem.instance;
    }

    this.autoConfigByRoom = new Map();
    this.autoTimerByRoom = new Map();
    this.autoDeadlineByRoom = new Map();
    this.boughtOrderByRoom = new Map();
    this.skipVotesByRoom = new Map();

    this.rooms = new Map();
    this.users = new Map();
    this.configuration = {
      bidWindowSecondsMin: 3,
      defaultCategory: 'General',
    };

    AuctionSystem.instance = this;
  }

  static getInstance() {
    if (!AuctionSystem.instance) {
      AuctionSystem.instance = new AuctionSystem();
    }
    return AuctionSystem.instance;
  }

  registerRoom(room) {
    if (!room || room.id == null) return;
    this.rooms.set(Number(room.id), room);
  }

  unregisterRoom(roomId) {
    this.rooms.delete(Number(roomId));
  }

  registerUser(user) {
    if (!user || user.id == null) return;
    this.users.set(Number(user.id), user);
  }

  unregisterUser(userId) {
    this.users.delete(Number(userId));
  }

  getConfig() {
    return this.configuration;
  }
}

module.exports = { AuctionSystem };
