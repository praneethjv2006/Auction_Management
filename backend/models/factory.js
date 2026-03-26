const {
  ParticipantObserver,
  AuctionRoomObserver,
  BiddableItemObservable,
} = require('./observer');
const {
  ManualBidStrategy,
  AutoBidStrategy,
  IncrementalBidStrategy,
  AIBidStrategy,
} = require('./strategy');
const { resolveItemState } = require('./state');

class AuctionFactory {
  static createAuctionRoom(data) {
    return {
      roomName: String(data.roomName).trim(),
      organizerId: Number(data.organizerId),
    };
  }

  static createItem(data) {
    return {
      name: String(data.name).trim(),
      price: Number(data.price),
      firstBid: Number(data.firstBid),
      currentBid: Number(data.currentBid),
      status: data.status,
      category: String(data.category),
      auctionRoomId: Number(data.auctionRoomId),
    };
  }

  static createParticipant(data) {
    return {
      name: String(data.name).trim(),
      participantCode: String(data.participantCode),
      email: data.email || null,
      purseAmount: Number(data.purseAmount),
      remainingPurse: Number(data.remainingPurse),
      roomId: Number(data.roomId),
    };
  }

  static createBid(data) {
    return {
      amount: Number(data.amount),
      participantId: Number(data.participantId),
      itemId: Number(data.itemId),
    };
  }

  static createAuctionRoomObserver(roomId) {
    return new AuctionRoomObserver(roomId);
  }

  static createParticipantObserver(participantId, onNewBid) {
    return new ParticipantObserver(participantId, onNewBid);
  }

  static createBiddableItem(item) {
    return new BiddableItemObservable(item);
  }

  static createItemState(status) {
    return resolveItemState(status);
  }

  static createBiddingStrategy(type) {
    switch (String(type || 'manual').toLowerCase()) {
      case 'auto':
        return new AutoBidStrategy();
      case 'proxy':
      case 'incremental':
        return new IncrementalBidStrategy();
      case 'ai':
        return new AIBidStrategy();
      case 'manual':
      default:
        return new ManualBidStrategy();
    }
  }
}

module.exports = { AuctionFactory };
