# Database Schema Documentation

This document provides a comprehensive overview of the database schema for the BRND system. It's designed to help non-technical team members understand the data structure and write SQL queries to extract information.

## Table Overview

The database consists of 10 main tables that handle user management, brand information, voting systems, and blockchain integration:

1. **users** - Core user information and statistics
2. **brands** - Brand information and performance metrics
3. **categories** - Brand categorization
4. **tags** - Tagging system for brands
5. **brand_tags** - Many-to-many relationship between brands and tags
6. **user_brand_votes** - User voting records and rewards
7. **user_daily_actions** - User daily activity tracking
8. **airdrop_scores** - Airdrop scoring and token allocation
9. **airdrop_snapshots** - Merkle tree snapshots for airdrops
10. **reward_claims** - Reward claiming records

---

## Table Schemas

### 1. users

Stores all user information and statistics.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key, auto-increment |
| fid | INTEGER | Unique Farcaster ID |
| username | VARCHAR | Farcaster username |
| photoUrl | VARCHAR | Profile photo URL (nullable) |
| points | INTEGER | Total points earned (default: 0) |
| role | ENUM | User role: 'user' or 'admin' |
| dailyStreak | INTEGER | Current daily streak (default: 0) |
| maxDailyStreak | INTEGER | Maximum daily streak achieved (nullable) |
| totalPodiums | INTEGER | Total podium finishes (default: 0) |
| votedBrandsCount | INTEGER | Number of brands voted for (default: 0) |
| brndPowerLevel | INTEGER | User's BRND power level (default: 0) |
| totalVotes | INTEGER | Total votes cast (default: 0) |
| lastVoteDay | INTEGER | Last day number when voted (default: 0) |
| lastVoteTimestamp | TIMESTAMP | Last vote timestamp (nullable) |
| address | VARCHAR | Wallet address (nullable) |
| banned | BOOLEAN | Whether user is banned (default: false) |
| powerups | INTEGER | Number of powerups (default: 0) |
| verified | BOOLEAN | Whether user is verified (default: false) |
| favoriteBrandId | INTEGER | Foreign key to brands table (nullable) |
| createdAt | TIMESTAMP | Record creation time |
| updatedAt | TIMESTAMP | Last update time |

**Common Queries:**
```sql
-- Get top users by points
SELECT username, points, totalVotes FROM users ORDER BY points DESC LIMIT 10;

-- Find verified users
SELECT username, fid, points FROM users WHERE verified = true;

-- Get users with current daily streak > 7
SELECT username, dailyStreak, maxDailyStreak FROM users WHERE dailyStreak > 7;
```

### 2. brands

Contains brand information and performance metrics.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key, auto-increment |
| name | VARCHAR | Brand name (unique) |
| url | VARCHAR | Brand website URL |
| warpcastUrl | VARCHAR | Warpcast profile URL |
| description | TEXT(4096) | Brand description |
| categoryId | INTEGER | Foreign key to categories table |
| followerCount | INTEGER | Number of followers |
| imageUrl | VARCHAR | Brand logo/image URL |
| profile | VARCHAR | Profile identifier |
| channel | VARCHAR | Channel identifier |
| ranking | VARCHAR | Current ranking |
| score | INTEGER | Current score |
| stateScore | INTEGER | State-based score |
| scoreWeek | INTEGER | Weekly score |
| stateScoreWeek | INTEGER | Weekly state score |
| rankingWeek | INTEGER | Weekly ranking (default: 0) |
| scoreMonth | INTEGER | Monthly score (default: 0) |
| stateScoreMonth | INTEGER | Monthly state score (default: 0) |
| rankingMonth | INTEGER | Monthly ranking (default: 0) |
| bonusPoints | INTEGER | Bonus points awarded (default: 0) |
| banned | INTEGER | Ban status (default: 0) |
| queryType | INTEGER | Query type: 0 for Channel, 1 for Profile |
| currentRanking | INTEGER | Current ranking position (default: 0) |
| **Blockchain Fields** | | |
| walletAddress | VARCHAR(42) | Wallet address for blockchain (nullable) |
| totalBrndAwarded | DECIMAL(36,18) | Total BRND tokens awarded (default: 0) |
| availableBrnd | DECIMAL(36,18) | Available BRND tokens (default: 0) |
| onChainCreatedAt | TIMESTAMP | On-chain creation time (nullable) |
| onChainId | INTEGER | On-chain ID (nullable, unique) |
| onChainFid | INTEGER | On-chain Farcaster ID (nullable) |
| onChainHandle | VARCHAR | On-chain handle (nullable) |
| onChainWalletAddress | VARCHAR(42) | On-chain wallet address (nullable) |
| metadataHash | VARCHAR | Metadata hash (nullable) |
| isUploadedToContract | BOOLEAN | Contract upload status (default: false) |
| createdAt | TIMESTAMP | Record creation time |
| updatedAt | TIMESTAMP | Last update time |

**Common Queries:**
```sql
-- Get top brands by score
SELECT name, score, currentRanking FROM brands ORDER BY score DESC LIMIT 10;

-- Find brands with blockchain integration
SELECT name, walletAddress, totalBrndAwarded FROM brands WHERE walletAddress IS NOT NULL;

-- Get brands by category
SELECT b.name, c.name as category_name FROM brands b 
JOIN categories c ON b.categoryId = c.id;
```

### 3. categories

Brand categorization system.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key, auto-increment |
| name | VARCHAR | Category name |
| createdAt | TIMESTAMP | Record creation time |
| updatedAt | TIMESTAMP | Last update time |

**Common Queries:**
```sql
-- List all categories with brand count
SELECT c.name, COUNT(b.id) as brand_count 
FROM categories c 
LEFT JOIN brands b ON c.id = b.categoryId 
GROUP BY c.id, c.name;
```

### 4. tags

Tagging system for brands.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key, auto-increment |
| name | VARCHAR | Tag name |
| createdAt | TIMESTAMP | Record creation time |
| updatedAt | TIMESTAMP | Last update time |

### 5. brand_tags

Many-to-many relationship between brands and tags.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key, auto-increment |
| tagId | INTEGER | Foreign key to tags table |
| brandId | INTEGER | Foreign key to brands table |

**Common Queries:**
```sql
-- Get all tags for a specific brand
SELECT t.name FROM tags t 
JOIN brand_tags bt ON t.id = bt.tagId 
WHERE bt.brandId = 1;

-- Find brands with specific tag
SELECT b.name FROM brands b 
JOIN brand_tags bt ON b.id = bt.brandId 
JOIN tags t ON bt.tagId = t.id 
WHERE t.name = 'technology';
```

### 6. user_brand_votes

Records user voting activity and rewards.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| userId | INTEGER | Foreign key to users table |
| brand1Id | INTEGER | Foreign key to brands table (1st choice) |
| brand2Id | INTEGER | Foreign key to brands table (2nd choice) |
| brand3Id | INTEGER | Foreign key to brands table (3rd choice) |
| date | TIMESTAMP | Vote date |
| shared | BOOLEAN | Whether vote was shared (default: false) |
| castHash | VARCHAR | Farcaster cast hash (nullable) |
| transactionHash | VARCHAR(66) | Blockchain transaction hash (nullable) |
| **Reward Fields** | | |
| rewardAmount | DECIMAL(64,18) | Reward amount (nullable) |
| day | INTEGER | Day number (nullable) |
| shareVerified | BOOLEAN | Share verification status (default: false) |
| shareVerifiedAt | TIMESTAMP | Share verification time (nullable) |
| signatureGeneratedAt | TIMESTAMP | Signature generation time (nullable) |
| nonce | INTEGER | Cryptographic nonce (nullable) |
| claimedAt | TIMESTAMP | Reward claim time (nullable) |
| claimTxHash | VARCHAR(66) | Claim transaction hash (nullable) |

**Common Queries:**
```sql
-- Get voting history for a user
SELECT u.username, b1.name as choice1, b2.name as choice2, b3.name as choice3, date 
FROM user_brand_votes ubv
JOIN users u ON ubv.userId = u.id
JOIN brands b1 ON ubv.brand1Id = b1.id
JOIN brands b2 ON ubv.brand2Id = b2.id
JOIN brands b3 ON ubv.brand3Id = b3.id
WHERE u.fid = 12345;

-- Get unclaimed rewards
SELECT * FROM user_brand_votes 
WHERE rewardAmount IS NOT NULL AND claimedAt IS NULL;
```

### 7. user_daily_actions

Tracks daily user activities for point calculations.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key, auto-increment |
| userId | INTEGER | Foreign key to users table |
| shareFirstTime | BOOLEAN | First-time share status |

### 8. airdrop_scores

Stores airdrop scoring calculations and token allocations.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key, auto-increment |
| fid | INTEGER | Farcaster ID (unique) |
| basePoints | DECIMAL(10,2) | Base points (default: 0) |
| followAccountsMultiplier | DECIMAL(10,4) | Follow accounts multiplier (default: 1.0) |
| channelInteractionMultiplier | DECIMAL(10,4) | Channel interaction multiplier (default: 1.0) |
| holdingBrndMultiplier | DECIMAL(10,4) | BRND holding multiplier (default: 1.0) |
| collectiblesMultiplier | DECIMAL(10,4) | Collectibles multiplier (default: 1.0) |
| votedBrandsMultiplier | DECIMAL(10,4) | Voted brands multiplier (default: 1.0) |
| sharedPodiumsMultiplier | DECIMAL(10,4) | Shared podiums multiplier (default: 1.0) |
| neynarScoreMultiplier | DECIMAL(10,4) | Neynar score multiplier (default: 1.0) |
| proUserMultiplier | DECIMAL(10,4) | Pro user multiplier (default: 1.0) |
| totalMultiplier | DECIMAL(10,4) | Total combined multiplier (default: 1.0) |
| finalScore | DECIMAL(15,2) | Final calculated score (default: 0) |
| tokenAllocation | BIGINT | Token allocation amount (default: 0) |
| percentage | DECIMAL(8,4) | Percentage of total allocation (default: 0) |
| createdAt | TIMESTAMP | Record creation time |
| updatedAt | TIMESTAMP | Last update time |

**Common Queries:**
```sql
-- Top airdrop recipients
SELECT u.username, a.finalScore, a.tokenAllocation, a.percentage 
FROM airdrop_scores a 
JOIN users u ON a.fid = u.fid 
ORDER BY a.finalScore DESC LIMIT 20;

-- Airdrop allocation summary
SELECT 
    COUNT(*) as total_users,
    SUM(tokenAllocation) as total_tokens,
    AVG(finalScore) as avg_score
FROM airdrop_scores;
```

### 9. airdrop_snapshots

Stores Merkle tree snapshots for blockchain airdrops.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key, auto-increment |
| merkleRoot | VARCHAR(66) | Merkle root hash (unique) |
| totalUsers | INTEGER | Total users in snapshot |
| totalTokens | BIGINT | Sum of all token allocations |
| treeData | JSON | Complete tree structure and leaves |
| snapshotDate | TIMESTAMP | Snapshot creation date |
| contractAddress | VARCHAR(42) | Deployed contract address (nullable) |
| deployedAt | TIMESTAMP | Contract deployment time (nullable) |
| createdAt | TIMESTAMP | Record creation time |

### 10. reward_claims

Tracks daily reward claims by users.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key, auto-increment |
| userFid | INTEGER | User's Farcaster ID |
| day | INTEGER | Day number for the claim |
| amount | DECIMAL(64,18) | Reward amount (nullable) |
| signatureGeneratedAt | TIMESTAMP | Signature generation time (nullable) |
| claimedAt | TIMESTAMP | Claim completion time (nullable) |
| claimTxHash | VARCHAR(66) | Claim transaction hash (nullable) |
| shareVerified | BOOLEAN | Share verification status (default: false) |
| shareVerifiedAt | TIMESTAMP | Share verification time (nullable) |
| castHash | VARCHAR | Farcaster cast hash (nullable) |
| nonce | INTEGER | Cryptographic nonce (nullable) |
| createdAt | TIMESTAMP | Record creation time |
| updatedAt | TIMESTAMP | Last update time |

**Note:** This table has a unique constraint on (userFid, day) to prevent duplicate claims.

---

## Relationships

### Key Relationships:
- **users.favoriteBrand** → **brands.id** (Many-to-One)
- **brands.category** → **categories.id** (Many-to-One)
- **user_brand_votes.user** → **users.id** (Many-to-One)
- **user_brand_votes.brand1/2/3** → **brands.id** (Many-to-One)
- **brand_tags.tag** → **tags.id** (Many-to-One)
- **brand_tags.brand** → **brands.id** (Many-to-One)
- **airdrop_scores.fid** → **users.fid** (One-to-One)

---

## Common Query Examples

### User Analytics
```sql
-- Most active users by total votes
SELECT username, totalVotes, points, dailyStreak 
FROM users 
ORDER BY totalVotes DESC LIMIT 10;

-- User engagement over time
SELECT u.username, COUNT(ubv.id) as vote_count, MAX(ubv.date) as last_vote
FROM users u 
LEFT JOIN user_brand_votes ubv ON u.id = ubv.userId
GROUP BY u.id, u.username
ORDER BY vote_count DESC;
```

### Brand Performance
```sql
-- Brand voting frequency (how often they appear in votes)
SELECT b.name,
    COUNT(CASE WHEN ubv.brand1Id = b.id THEN 1 END) as first_choice,
    COUNT(CASE WHEN ubv.brand2Id = b.id THEN 1 END) as second_choice,
    COUNT(CASE WHEN ubv.brand3Id = b.id THEN 1 END) as third_choice,
    COUNT(*) as total_votes
FROM brands b
LEFT JOIN user_brand_votes ubv ON b.id IN (ubv.brand1Id, ubv.brand2Id, ubv.brand3Id)
GROUP BY b.id, b.name
ORDER BY total_votes DESC;
```

### Rewards and Blockchain
```sql
-- Unclaimed rewards summary
SELECT 
    COUNT(*) as unclaimed_count,
    SUM(CAST(rewardAmount AS DECIMAL)) as total_unclaimed
FROM user_brand_votes 
WHERE rewardAmount IS NOT NULL AND claimedAt IS NULL;

-- Daily reward claims
SELECT 
    DATE(claimedAt) as claim_date,
    COUNT(*) as claims_count,
    SUM(CAST(amount AS DECIMAL)) as total_amount
FROM reward_claims 
WHERE claimedAt IS NOT NULL
GROUP BY DATE(claimedAt)
ORDER BY claim_date DESC;
```

---

## Data Types Reference

- **INTEGER**: Whole numbers
- **BIGINT**: Large whole numbers
- **DECIMAL(p,s)**: Decimal numbers with p total digits and s decimal places
- **VARCHAR(n)**: Text with maximum n characters
- **TEXT**: Long text content
- **BOOLEAN**: true/false values
- **TIMESTAMP**: Date and time
- **JSON**: Structured JSON data
- **UUID**: Universally unique identifier

---

## Notes for SQL Queries

1. **Always use proper JOINs** when accessing related data across tables
2. **Be careful with DECIMAL fields** - some may need to be cast for calculations
3. **Use DATE functions** for time-based analysis (DATE(), MONTH(), YEAR(), etc.)
4. **Foreign key relationships** are enforced, so referenced records must exist
5. **Unique constraints** prevent duplicate entries where specified
6. **Nullable fields** may contain NULL values - use IS NULL/IS NOT NULL for checks

This schema supports a comprehensive voting and rewards system with blockchain integration for the BRND platform.