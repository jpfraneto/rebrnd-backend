# Frontend Integration Prompt for BRND Blockchain Features

## Overview

The backend has been completely implemented with blockchain signature generation for the StoriesInMotionV1 smart contract. You need to implement the frontend integration to connect users' wallets, enable power level progression, and facilitate on-chain voting with BRND token economics.

## Smart Contract Details

**Contract Address**: `0xAf5806B62EC2dB8519BfE408cF521023Bc5C7e61` (Base Mainnet)
**Chain**: Base (Chain ID: 8453)
**Domain**: StoriesInMotionV1 v1

## Backend API Endpoints Available

### 1. Authorization Signature
**POST** `/blockchain-service/authorize-wallet`
```json
// Request
{
  "walletAddress": "0x1234...",
  "deadline": 1703980800  // Unix timestamp 
}

// Response  
{
  "authData": "0x...",    // Encoded for contract call
  "fid": 12345,
  "walletAddress": "0x1234...", 
  "deadline": 1703980800
}
```

### 2. Level Up Signature
**POST** `/blockchain-service/level-up`
```json
// Request
{
  "newLevel": 2,
  "deadline": 1703980800
}

// Response
{
  "signature": "0x...",
  "fid": 12345,
  "newLevel": 2,
  "deadline": 1703980800,
  "validation": {
    "eligible": true,
    "currentLevel": 1,
    "nextLevel": 2,
    "requirements": [
      {
        "met": true,
        "description": "Follow @brnd on Farcaster",
        "current": 1,
        "required": 1
      }
    ]
  }
}
```

### 3. Reward Claim Signature  
**POST** `/blockchain-service/claim-reward`
```json
// Request
{
  "amount": "1000000000000000000", // Wei amount
  "day": 19720,                    // Day number
  "deadline": 1703980800
}

// Response
{
  "signature": "0x...",
  "fid": 12345,
  "amount": "1000000000000000000",
  "day": 19720,
  "deadline": 1703980800
}
```

### 4. Power Level Info
**GET** `/blockchain-service/power-level/:fid`
```json
// Response
{
  "currentLevel": 2,
  "currentPowerLevel": {
    "id": 2,
    "title": "STAKE 2M $BRND",
    "description": "x2 rewards",
    "multiplier": 2,
    "isCompleted": true,
    "isActive": false,
    "actionType": "stake",
    "requirement": {
      "type": "stake",
      "value": 2000000,
      "unit": "BRND"
    }
  },
  "nextLevel": { /* Level 3 details */ },
  "allLevels": [ /* All 8 levels with progress */ ],
  "progress": {
    "followingBrnd": true,
    "stakedAmount": 2500000,
    "totalBalance": 3000000,
    "dailyStreak": 3,
    "totalPodiums": 45,
    "collectibles": 0
  }
}
```

### 5. Stake Information
**GET** `/blockchain-service/user-stake/:fid`
```json
// Response
{
  "walletBalance": 1000000,      // BRND in wallet
  "vaultShares": 0,              // Raw vault shares
  "stakedAmount": 2000000,       // BRND staked (includes rewards)
  "totalBalance": 3000000,       // wallet + staked
  "addresses": ["0x1234..."]     // Verified addresses
}
```

## Frontend Implementation Tasks

### 1. Wallet Connection System

**Requirements:**
- Connect user's wallet (MetaMask, Coinbase Wallet, etc.)
- Switch to Base network (Chain ID: 8453)
- Get authorization signature from backend
- Call `authorizeWallet()` on smart contract

**Implementation:**
```typescript
// 1. Connect wallet and switch to Base
const wallet = await connectWallet();
await switchToBase();

// 2. Get authorization signature  
const authResponse = await fetch('/blockchain-service/authorize-wallet', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${farcasterToken}` },
  body: JSON.stringify({
    walletAddress: wallet.address,
    deadline: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
  })
});

const { authData } = await authResponse.json();

// 3. Call smart contract
const contract = new ethers.Contract(contractAddress, abi, wallet);
await contract.authorizeWallet(fid, deadline, authData);
```

### 2. Power Level System UI

**Requirements:**
- Display all 8 power levels with progress
- Show current level and next level requirements  
- Enable level up when requirements are met
- Real-time progress tracking

**Components to Implement:**
```typescript
// PowerLevelCard.tsx - Individual level display
interface PowerLevelCardProps {
  level: PowerLevel;
  isActive: boolean;
  onLevelUp?: () => void;
}

// PowerLevelProgress.tsx - Progress bars and indicators
interface ProgressProps {
  current: number;
  total: number;
  label: string;
}

// LevelUpModal.tsx - Confirmation modal for leveling up
interface LevelUpModalProps {
  targetLevel: number;
  requirements: Requirement[];
  onConfirm: () => Promise<void>;
}
```

**Level Up Flow:**
```typescript
const handleLevelUp = async (targetLevel: number) => {
  try {
    // 1. Get level up signature from backend
    const response = await fetch('/blockchain-service/level-up', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${farcasterToken}` },
      body: JSON.stringify({
        newLevel: targetLevel,
        deadline: Math.floor(Date.now() / 1000) + 3600
      })
    });

    const { signature, validation } = await response.json();

    if (!validation.eligible) {
      throw new Error(`Cannot level up: ${validation.reason}`);
    }

    // 2. Call smart contract
    const contract = new ethers.Contract(contractAddress, abi, wallet);
    const tx = await contract.levelUpBrndPower(
      fid,
      targetLevel, 
      Math.floor(Date.now() / 1000) + 3600,
      signature
    );

    await tx.wait();
    
    // 3. Refresh power level data
    await refreshPowerLevel();
    
  } catch (error) {
    console.error('Level up failed:', error);
  }
};
```

### 3. Enhanced Voting System

**Requirements:**
- Integrate existing voting with smart contract
- Show vote cost based on power level
- Handle BRND token approval and transfer
- Call smart contract `vote()` function

**Vote Cost Calculation:**
```typescript
const getVoteCost = (brndPowerLevel: number): bigint => {
  if (brndPowerLevel === 0) return 0n;
  if (brndPowerLevel >= 8) return parseEther('800'); // 8 * 100 BRND
  return parseEther((brndPowerLevel * 100).toString());
};
```

**Enhanced Vote Flow:**
```typescript
const handleVote = async (brandIds: [number, number, number]) => {
  try {
    // 1. Get user's power level
    const powerLevel = await getCurrentPowerLevel();
    const voteCost = getVoteCost(powerLevel.currentLevel);

    // 2. Check BRND balance and approve if needed
    if (voteCost > 0) {
      const brndContract = new ethers.Contract(BRND_TOKEN_ADDRESS, ERC20_ABI, wallet);
      const balance = await brndContract.balanceOf(wallet.address);
      
      if (balance < voteCost) {
        throw new Error('Insufficient BRND balance');
      }

      const allowance = await brndContract.allowance(wallet.address, contractAddress);
      if (allowance < voteCost) {
        const approveTx = await brndContract.approve(contractAddress, voteCost);
        await approveTx.wait();
      }
    }

    // 3. Get authorization if needed (for first-time voters)
    let authData = '0x';
    if (!isWalletAuthorized) {
      const authResponse = await fetch('/blockchain-service/authorize-wallet', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${farcasterToken}` },
        body: JSON.stringify({
          walletAddress: wallet.address,
          deadline: Math.floor(Date.now() / 1000) + 3600
        })
      });
      const { authData: auth } = await authResponse.json();
      authData = auth;
    }

    // 4. Call smart contract vote function
    const contract = new ethers.Contract(contractAddress, abi, wallet);
    const tx = await contract.vote(brandIds, authData);
    await tx.wait();

    // 5. Update UI
    await refreshVotingData();
    
  } catch (error) {
    console.error('Vote failed:', error);
  }
};
```

### 4. Reward Claiming System

**Requirements:**
- Display claimable rewards (basic BRND + performance rewards)
- Enable claiming basic BRND (accumulated from votes)
- Enable claiming performance rewards (with backend signature)

**Claim Basic BRND:**
```typescript
const claimBasicBrnd = async () => {
  try {
    const contract = new ethers.Contract(contractAddress, abi, wallet);
    const tx = await contract.claimBasicBrnd();
    await tx.wait();
    
    await refreshBalances();
  } catch (error) {
    console.error('Claim failed:', error);
  }
};
```

**Claim Performance Rewards:**
```typescript
const claimPerformanceReward = async (amount: string, day: number) => {
  try {
    // 1. Get claim signature from backend
    const response = await fetch('/blockchain-service/claim-reward', {
      method: 'POST', 
      headers: { 'Authorization': `Bearer ${farcasterToken}` },
      body: JSON.stringify({
        amount,
        day,
        deadline: Math.floor(Date.now() / 1000) + 3600
      })
    });

    const { signature } = await response.json();

    // 2. Call smart contract
    const contract = new ethers.Contract(contractAddress, abi, wallet);
    const tx = await contract.claimReward(
      amount,
      fid,
      day,
      Math.floor(Date.now() / 1000) + 3600,
      signature
    );
    await tx.wait();
    
    await refreshBalances();
  } catch (error) {
    console.error('Reward claim failed:', error);
  }
};
```

### 5. BRND Staking Integration

**Requirements:**
- Display current staked amount
- Show staking APY and rewards
- Enable staking more BRND
- Enable unstaking BRND

**Staking Flow:**
```typescript
const stakeBrnd = async (amount: bigint) => {
  try {
    // 1. Approve BRND to Teller vault
    const brndContract = new ethers.Contract(BRND_TOKEN_ADDRESS, ERC20_ABI, wallet);
    const approveTx = await brndContract.approve(TELLER_VAULT_ADDRESS, amount);
    await approveTx.wait();

    // 2. Deposit to vault
    const vaultContract = new ethers.Contract(TELLER_VAULT_ADDRESS, ERC4626_ABI, wallet);
    const tx = await vaultContract.deposit(amount, wallet.address);
    await tx.wait();

    // 3. Refresh staking data
    await refreshStakeInfo();
  } catch (error) {
    console.error('Staking failed:', error);
  }
};
```

### 6. UI Components Needed

**Power Level Components:**
- `PowerLevelDashboard` - Main power level interface
- `PowerLevelCard` - Individual level display
- `ProgressBar` - Progress indicators
- `LevelUpButton` - Action buttons with validation
- `RequirementsList` - Show what's needed for next level

**Wallet Components:**
- `WalletConnection` - Connect/disconnect wallet
- `NetworkSwitcher` - Switch to Base network
- `BalanceDisplay` - Show BRND wallet + staked balances
- `TransactionStatus` - Show pending/confirmed transactions

**Staking Components:**
- `StakingDashboard` - Staking interface
- `StakeInput` - Amount input with validation
- `StakeStats` - APY, rewards, etc.
- `UnstakeModal` - Unstaking interface

**Enhanced Voting:**
- `VoteCostDisplay` - Show cost based on power level
- `VoteConfirmation` - Confirm vote with cost
- `VoteHistory` - Show on-chain vote history

### 7. Required Contract ABIs

```typescript
// Smart Contract ABI (key functions)
const STORIES_IN_MOTION_ABI = [
  "function authorizeWallet(uint256 fid, uint256 deadline, bytes memory signature)",
  "function levelUpBrndPower(uint256 fid, uint8 newLevel, uint256 deadline, bytes calldata signature)",
  "function vote(uint16[3] calldata brandIds, bytes calldata authData)",
  "function claimBasicBrnd()",
  "function claimReward(uint256 amount, uint256 fid, uint256 day, uint256 deadline, bytes calldata signature)",
  "function getUserInfo(address wallet) view returns (uint256 fid, uint8 brndPowerLevel, uint32 lastVoteDay, uint128 unclaimedBrnd)",
  "function hasVotedToday(address wallet, uint256 day) view returns (bool)",
  "function getVoteCost(uint8 brndPowerLevel) pure returns (uint256)"
];

// BRND Token ABI
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

// Teller Vault ABI  
const ERC4626_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256)"
];
```

### 8. Environment Variables

```env
NEXT_PUBLIC_CONTRACT_ADDRESS=0xAf5806B62EC2dB8519BfE408cF521023Bc5C7e61
NEXT_PUBLIC_BRND_TOKEN_ADDRESS=0x41Ed0311640A5e489A90940b1c33433501a21B07
NEXT_PUBLIC_TELLER_VAULT_ADDRESS=0x19d1872d8328b23a219e11d3d6eeee1954a88f88
NEXT_PUBLIC_BASE_RPC_URL=https://mainnet.base.org
NEXT_PUBLIC_CHAIN_ID=8453
```

### 9. Testing Checklist

**Wallet Connection:**
- [ ] Connect to MetaMask/Coinbase Wallet
- [ ] Switch to Base network
- [ ] Authorize wallet with smart contract
- [ ] Handle connection errors gracefully

**Power Level System:**
- [ ] Display all 8 levels correctly
- [ ] Show real-time progress
- [ ] Enable level up when requirements met
- [ ] Block level up when requirements not met
- [ ] Handle level up transactions

**Enhanced Voting:**
- [ ] Show vote cost based on power level
- [ ] Handle BRND token approval
- [ ] Submit votes to smart contract
- [ ] Track vote history on-chain

**Rewards:**
- [ ] Display claimable basic BRND
- [ ] Claim basic BRND successfully
- [ ] Display performance rewards
- [ ] Claim performance rewards with signature

**Staking:**
- [ ] Display current staked amount
- [ ] Stake additional BRND
- [ ] Unstake BRND tokens
- [ ] Show staking rewards/APY

### 10. Error Handling

Implement robust error handling for:
- Network connection issues
- Transaction failures
- Insufficient balances
- Contract reverts
- Signature failures
- Backend API errors

### 11. State Management

Consider using a state management solution (Redux, Zustand, etc.) to manage:
- Wallet connection state
- User power level data
- Staking information
- Transaction status
- Error states

## Success Criteria

The implementation is successful when:
1. Users can connect their wallets and authorize with the smart contract
2. Power level progression works end-to-end with backend validation
3. Voting integrates with smart contract and BRND token economics
4. Reward claiming works for both basic and performance rewards
5. Staking integration allows users to stake/unstake BRND
6. All transactions are properly confirmed and UI updates accordingly
7. Error handling provides clear feedback to users

This integration will transform your Farcaster miniapp into a full on-chain experience with token economics, power progression, and blockchain-verified voting!