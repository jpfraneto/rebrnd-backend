# Blockchain Integration Implementation

## Overview

This implementation provides complete backend support for the StoriesInMotionV1 smart contract deployed at `0xAf5806B62EC2dB8519BfE408cF521023Bc5C7e61` on Base mainnet.

## New Module Structure

```
src/core/blockchain/
├── blockchain.module.ts           # Module configuration
├── blockchain.controller.ts       # API endpoints
└── services/
    ├── blockchain.service.ts      # Blockchain interactions
    ├── power-level.service.ts     # Power level logic
    ├── signature.service.ts       # EIP-712 signature generation
    └── index.ts                   # Service exports
```

## API Endpoints

### 1. Authorization Signature
**POST** `/blockchain-service/authorize-wallet`

Generates EIP-712 signature for wallet authorization.

**Request:**
```json
{
  "walletAddress": "0x1234...",
  "deadline": 1703980800
}
```

**Response:**
```json
{
  "authData": "0x...",
  "fid": 12345,
  "walletAddress": "0x1234...",
  "deadline": 1703980800
}
```

### 2. Level Up Signature
**POST** `/blockchain-service/level-up`

Generates signature for power level upgrades with validation.

**Request:**
```json
{
  "newLevel": 2,
  "deadline": 1703980800
}
```

**Response:**
```json
{
  "signature": "0x...",
  "fid": 12345,
  "newLevel": 2,
  "deadline": 1703980800,
  "validation": {
    "eligible": true,
    "currentLevel": 1,
    "nextLevel": 2,
    "requirements": [...]
  }
}
```

### 3. Reward Claim Signature
**POST** `/blockchain-service/claim-reward`

Generates signature for reward claiming.

**Request:**
```json
{
  "amount": "1000000000000000000",
  "day": 19720,
  "deadline": 1703980800
}
```

### 4. Power Level Information
**GET** `/blockchain-service/power-level/:fid`

Returns user's current power level and progress.

### 5. Stake Information
**GET** `/blockchain-service/user-stake/:fid`

Returns user's BRND staking information.

## Power Level System

Implements 8 power levels with automatic validation:

1. **Level 1**: Follow @BRND → x1 rewards
2. **Level 2**: Stake 2M BRND → x2 rewards
3. **Level 3**: 5-day voting streak → x3 rewards
4. **Level 4**: Stake 4M BRND → x4 rewards
5. **Level 5**: Vote 100 podiums → x5 rewards
6. **Level 6**: Stake 6M BRND → x6 rewards
7. **Level 7**: Collect 7 BRND collectibles → x7 rewards
8. **Level 8**: Stake 8M BRND → x8 rewards

## Validation Logic

### Follow Verification
- Uses Neynar API to check if user follows @brnd (FID: 1108951)
- Real-time verification for level 1 requirements

### Staking Verification
- Integrates with Teller Finance ERC4626 vault
- Checks both wallet balance and staked balance
- Supports multiple verified addresses per user

### Progress Tracking
- Tracks daily streaks, total podiums, voted brands
- Updates User model with `brndPowerLevel` field
- Real-time progress calculation

## Security Features

- **EIP-712 signatures** for all smart contract interactions
- **Farcaster authentication** required for all endpoints
- **Nonce management** to prevent replay attacks
- **Deadline validation** for time-bound signatures
- **Progressive leveling** (can only level up one level at a time)

## Environment Variables Required

```env
PRIVATE_KEY=0x...                    # Backend signer private key
CONTRACT_ADDRESS=0xAf5806B62EC...    # Smart contract address
BRND_TOKEN_ADDRESS=0x41Ed031...      # BRND token contract
TELLER_VAULT_ADDRESS=0x19d1872...    # Teller vault contract
BASE_RPC_URL=https://mainnet.base.org
NEYNAR_API_KEY=...                   # For follow verification
```

## Database Changes

Added to User model:
```typescript
@Column({ default: 0 })
brndPowerLevel: number;
```

## Smart Contract Integration

### EIP-712 Domain
```typescript
{
  name: "StoriesInMotionV1",
  version: "1",
  chainId: 8453,
  verifyingContract: "0xAf5806B62EC2dB8519BfE408cF521023Bc5C7e61"
}
```

### Signature Types
- **Authorization**: `(uint256 fid, address wallet, uint256 deadline)`
- **LevelUp**: `(uint256 fid, uint8 newLevel, uint256 nonce, uint256 deadline)`
- **ClaimReward**: `(address user, uint256 amount, uint256 fid, uint256 day, uint256 nonce, uint256 deadline)`

## Frontend Integration

The backend provides all necessary signatures for:
1. **Wallet connection** via `authorizeWallet` function
2. **Power level upgrades** via `levelUpBrndPower` function  
3. **Reward claiming** via `claimReward` function

Frontend should:
1. Request signature from backend
2. Call smart contract with signature
3. Handle transaction confirmation
4. Update UI based on blockchain state

## Testing

All endpoints require Farcaster authentication. Use existing QuickAuth flow to test:

1. **Authorization**: Test with valid wallet address and future deadline
2. **Level Up**: Test progression through levels 1-8
3. **Rewards**: Test claim signatures with proper amounts
4. **Power Level**: Verify real-time progress tracking
5. **Staking**: Confirm Teller vault integration

## Monitoring

The implementation includes comprehensive logging:
- Signature generation steps
- Blockchain calls and responses
- Power level calculations
- Validation results

Use these logs to monitor and debug the integration.