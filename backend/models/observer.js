class ParticipantObserver {
  constructor(participantId, onNewBid) {
    this.participantId = Number(participantId);
    this.onNewBid = typeof onNewBid === 'function' ? onNewBid : () => {};
  }

  update(event) {
    if (!event || event.type !== 'NewBid') return;
    this.onNewBid({
      ...event,
      participantId: this.participantId,
    });
  }
}

class AuctionRoomObserver {
  constructor(roomId) {
    this.roomId = Number(roomId);
    this.observers = new Set();
  }

  addObserver(participant) {
    if (!participant || typeof participant.update !== 'function') return;
    this.observers.add(participant);
  }

  removeObserver(participant) {
    this.observers.delete(participant);
  }

  notifyObservers(event) {
    for (const participant of this.observers) {
      participant.update(event);
    }
  }

  update(event) {
    if (!event || event.type !== 'BidUpdated') return;
    this.notifyObservers({
      type: 'NewBid',
      roomId: this.roomId,
      payload: event.payload,
    });
  }
}

class BiddableItemObservable {
  constructor(item) {
    this.id = item.id;
    this.status = item.status;
    this.currentBid = item.currentBid;
    this.winnerId = item.winnerId;
    this.observers = new Set();
  }

  addObserver(participant) {
    if (!participant || typeof participant.update !== 'function') return;
    this.observers.add(participant);
  }

  removeObserver(participant) {
    this.observers.delete(participant);
  }

  notifyObservers(event) {
    for (const observer of this.observers) {
      observer.update(event);
    }
  }

  setCurrentBid(amount, winnerId) {
    this.currentBid = amount;
    this.winnerId = winnerId;
    this.notifyObservers({
      type: 'BidUpdated',
      payload: {
        itemId: this.id,
        currentBid: amount,
        winnerId,
      },
    });
  }
}

module.exports = {
  ParticipantObserver,
  AuctionRoomObserver,
  BiddableItemObservable,
};
