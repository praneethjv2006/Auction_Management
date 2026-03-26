const { AuctionFactory } = require('./factory');

function processBidWithPatterns({
  roomId,
  item,
  participant,
  requestedAmount,
  participantIds,
  strategyType,
  strategyOptions,
}) {
  const strategy = AuctionFactory.createBiddingStrategy(strategyType);
  const bidAmount = strategy.executeBid({
    requestedAmount,
    currentBid: item.currentBid,
    participant,
    item,
    ...(strategyOptions || {}),
  });

  const roomObserver = AuctionFactory.createAuctionRoomObserver(roomId);
  const notifications = [];

  for (const participantId of participantIds || []) {
    const observer = AuctionFactory.createParticipantObserver(participantId, (event) => {
      notifications.push(event);
    });
    roomObserver.addObserver(observer);
  }

  const observableItem = AuctionFactory.createBiddableItem(item);
  observableItem.addObserver(roomObserver);

  const itemState = AuctionFactory.createItemState(item.status);
  itemState.updateBid(observableItem, {
    amount: bidAmount,
    participantId: participant.id,
  });

  return {
    bidAmount: observableItem.currentBid,
    winnerId: observableItem.winnerId,
    participantNotifications: notifications,
  };
}

module.exports = { processBidWithPatterns };
