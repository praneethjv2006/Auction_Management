class BiddingStrategy {
  executeBid() {
    throw new Error('executeBid must be implemented by a concrete strategy');
  }
}

class ManualBidStrategy extends BiddingStrategy {
  executeBid(context) {
    return Number(context.requestedAmount);
  }
}

class AutoBidStrategy extends BiddingStrategy {
  executeBid(context) {
    const requested = Number(context.requestedAmount);
    if (!Number.isFinite(requested)) return requested;

    const maxAmount = Number(context.maxAmount);
    if (!Number.isFinite(maxAmount)) return requested;

    return Math.min(requested, maxAmount);
  }
}

class IncrementalBidStrategy extends BiddingStrategy {
  executeBid(context) {
    const requested = Number(context.requestedAmount);
    const currentBid = Number(context.currentBid || 0);
    const increment = Number(context.increment || 1);

    if (!Number.isFinite(requested)) return requested;

    if (requested > currentBid) {
      return requested;
    }

    return currentBid + Math.max(1, increment);
  }
}

class AIBidStrategy extends BiddingStrategy {
  executeBid(context) {
    return Number(context.requestedAmount);
  }
}

module.exports = {
  BiddingStrategy,
  ManualBidStrategy,
  AutoBidStrategy,
  IncrementalBidStrategy,
  AIBidStrategy,
};
