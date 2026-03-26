class ItemState {
  updateBid() {
    throw new Error('updateBid must be implemented by a concrete item state');
  }

  declareWinner(item) {
    return item && item.winnerId ? 'sold' : 'unsold';
  }
}

class UnsoldState extends ItemState {
  updateBid() {
    throw new Error('Bidding is not open for this item');
  }
}

class InProgressState extends ItemState {
  updateBid(item, bid) {
    if (!item || typeof item.setCurrentBid !== 'function') {
      throw new Error('Invalid item reference for bidding');
    }

    item.setCurrentBid(Number(bid.amount), Number(bid.participantId));
    return item;
  }
}

class SoldState extends ItemState {
  updateBid() {
    throw new Error('Bidding is closed for sold item');
  }
}

function resolveItemState(status) {
  if (status === 'ongoing') return new InProgressState();
  if (status === 'sold') return new SoldState();
  return new UnsoldState();
}

module.exports = {
  ItemState,
  UnsoldState,
  InProgressState,
  SoldState,
  resolveItemState,
};
