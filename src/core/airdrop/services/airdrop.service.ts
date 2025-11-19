import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AirdropScore, AirdropSnapshot, User } from '../../../models';
import { getConfig } from '../../../security/config';
import { MerkleTree } from 'merkletreejs';
import keccak256 from 'keccak256';
import { solidityPackedKeccak256 } from 'ethers';

export interface AirdropMultipliers {
  followAccounts: number;
  channelInteraction: number;
  holdingBrnd: number;
  collectibles: number;
  votedBrands: number;
  sharedPodiums: number;
  neynarScore: number;
  proUser: number;
}

export interface ChallengeBreakdown {
  name: string;
  description: string;
  currentValue: number;
  currentMultiplier: number;
  maxMultiplier: number;
  completed: boolean;
  progress: {
    current: number;
    required: number;
    unit: string;
  };
  tiers: {
    requirement: number;
    multiplier: number;
    achieved: boolean;
  }[];
  details?: {
    [key: string]: any;
  };
}

export interface AirdropCalculation {
  fid: number;
  basePoints: number;
  multipliers: AirdropMultipliers;
  totalMultiplier: number;
  finalScore: number;
  tokenAllocation: number;
  percentage: number;
  leaderboardPosition: number;
  challenges: ChallengeBreakdown[];
  previousScore?: {
    finalScore: number;
    lastUpdated: Date;
  };
}

@Injectable()
export class AirdropService {
  private readonly TOTAL_ALLOCATION = 1_500_000_000;
  private readonly TOP_USERS = 1111;

  constructor(
    @InjectRepository(AirdropScore)
    private readonly airdropScoreRepository: Repository<AirdropScore>,
    @InjectRepository(AirdropSnapshot)
    private readonly airdropSnapshotRepository: Repository<AirdropSnapshot>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async checkUserEligibility(fid: number): Promise<AirdropCalculation> {
    console.log(`🎯 [AIRDROP] Starting eligibility check for FID: ${fid}`);

    const user = await this.userRepository.findOne({ where: { fid } });
    if (!user) {
      console.log(`❌ [AIRDROP] User not found for FID: ${fid}`);
      throw new Error('User not found');
    }

    console.log(`👤 [AIRDROP] Found user:`, {
      fid: user.fid,
      username: user.username,
      systemPoints: user.points,
    });

    // Check if user already has an airdrop score
    const existingAirdropScore = await this.airdropScoreRepository.findOne({
      where: { fid },
      relations: ['user'],
    });

    if (existingAirdropScore) {
      console.log(`📊 [AIRDROP] Found existing airdrop score:`, {
        previousAirdropScore: Number(existingAirdropScore.finalScore),
        lastUpdated: existingAirdropScore.updatedAt,
      });
    } else {
      console.log(
        `🆕 [AIRDROP] No existing airdrop score found, will create new one`,
      );
    }

    // STEP 1: Get base points (user's accumulated system points)
    const userSystemPoints = user.points;
    console.log(
      `📈 [AIRDROP] STEP 1 - Base Points (User's System Points): ${userSystemPoints}`,
    );

    // STEP 2: Calculate all multipliers
    console.log(`🔢 [AIRDROP] STEP 2 - Calculating multipliers...`);
    const multiplierData = await this.calculateMultipliersWithBreakdown(fid);

    // STEP 3: Calculate total multiplier
    const totalMultiplier = this.calculateTotalMultiplier(
      multiplierData.multipliers,
    );
    console.log(`✖️ [AIRDROP] STEP 3 - Total Multiplier: ${totalMultiplier}`, {
      breakdown: multiplierData.multipliers,
    });

    // STEP 4: Calculate final airdrop score
    const airdropScore = Math.round(userSystemPoints * totalMultiplier);
    console.log(`🏆 [AIRDROP] STEP 4 - Final Airdrop Score Calculation:`);
    console.log(
      `   ${userSystemPoints} (base points) × ${totalMultiplier} (total multiplier) = ${airdropScore}`,
    );

    // Get the actual tokenAllocation and percentage from the saved airdrop score
    let percentage = 0;
    let tokenAllocation = 0;
    
    if (existingAirdropScore) {
      percentage = Number(existingAirdropScore.percentage) || 0;
      tokenAllocation = Number(existingAirdropScore.tokenAllocation) || 0;
      console.log(`📊 [AIRDROP] Using existing token allocation: ${tokenAllocation.toLocaleString()}, percentage: ${percentage.toFixed(6)}%`);
    }

    // STEP 5: Calculate leaderboard position based on new airdrop score
    console.log(`🏅 [AIRDROP] STEP 5 - Calculating leaderboard position...`);
    const leaderboardPosition = await this.getUserLeaderboardPosition(
      fid,
      airdropScore,
    );
    console.log(`📍 [AIRDROP] Leaderboard position: #${leaderboardPosition}`);

    const calculation: AirdropCalculation = {
      fid,
      basePoints: userSystemPoints,
      multipliers: multiplierData.multipliers,
      totalMultiplier,
      finalScore: airdropScore,
      tokenAllocation,
      percentage,
      leaderboardPosition,
      challenges: multiplierData.challenges,
      previousScore: existingAirdropScore
        ? {
            finalScore: Number(existingAirdropScore.finalScore),
            lastUpdated: existingAirdropScore.updatedAt,
          }
        : undefined,
    };

    console.log(`💾 [AIRDROP] STEP 6 - Saving airdrop score to database...`);
    await this.saveAirdropScore(calculation);

    console.log(`✅ [AIRDROP] Final calculation summary:`, {
      fid,
      userSystemPoints,
      totalMultiplier,
      newAirdropScore: airdropScore,
      leaderboardPosition,
      tokenAllocation,
    });

    return calculation;
  }

  private calculateTotalMultiplier(multipliers: AirdropMultipliers): number {
    return Object.values(multipliers).reduce(
      (total, multiplier) => total * multiplier,
      1,
    );
  }

  private async getNeynarUserInfo(fid: number): Promise<any> {
    try {
      console.log(`🔍 [NEYNAR] Fetching user info for FID: ${fid}`);
      const apiKey = getConfig().neynar.apiKey.replace(/&$/, '');

      const response = await fetch(
        `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`,
        {
          headers: {
            accept: 'application/json',
            api_key: apiKey,
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Neynar API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      console.log(`✅ [NEYNAR] User info retrieved:`, data?.users?.[0]);
      return data?.users?.[0] || null;
    } catch (error) {
      console.error('Error fetching user info:', error);
      return null;
    }
  }

  private async calculateFollowAccountsMultiplier(fid: number): Promise<{
    multiplier: number;
    followedCount: number;
    details: {
      followingBrnd: boolean;
      followingFloc: boolean;
    };
  }> {
    try {
      console.log(
        `🔍 [FOLLOW ACCOUNTS] Checking follow status for FID: ${fid}`,
      );
      const apiKey = getConfig().neynar.apiKey.replace(/&$/, '');
      const BRND_FID = 1108951;
      const FLOC_FID = 6946;

      // Check Farcaster follows
      const response = await fetch(
        `https://api.neynar.com/v2/farcaster/user/bulk?fids=${BRND_FID},${FLOC_FID}&viewer_fid=${fid}`,
        {
          headers: {
            accept: 'application/json',
            api_key: apiKey,
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Neynar API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      console.log(`✅ [FOLLOW ACCOUNTS] Follow data retrieved:`, data);

      const users = data?.users || [];
      const brndUser = users.find((u) => u.fid === BRND_FID);
      const flocUser = users.find((u) => u.fid === FLOC_FID);

      const followingBrnd = brndUser?.viewer_context?.following || false;
      const followingFloc = flocUser?.viewer_context?.following || false;

      const details = {
        followingBrnd,
        followingFloc,
      };

      const followedCount = [followingBrnd, followingFloc].filter(
        Boolean,
      ).length;

      console.log(`📱 [FOLLOW ACCOUNTS] Follow status:`, details);

      let multiplier = 1.0;
      if (followedCount >= 2)
        multiplier = 1.4; // Follow both @brnd and @floc
      else if (followedCount >= 1) multiplier = 1.2; // Follow at least one account

      console.log(`📱 [FOLLOW ACCOUNTS] Multiplier calculation:`, {
        followedCount,
        multiplier,
        logic:
          followedCount >= 2
            ? 'Both accounts (1.4x)'
            : followedCount >= 1
              ? 'One account (1.2x)'
              : 'No accounts (1.0x)',
      });

      return { multiplier, followedCount, details };
    } catch (error) {
      console.error('Error calculating follow accounts multiplier:', error);
      return {
        multiplier: 1.0,
        followedCount: 0,
        details: {
          followingBrnd: false,
          followingFloc: false,
        },
      };
    }
  }

  private async checkChannelFollow(fid: number): Promise<boolean> {
    try {
      console.log(`🔍 [NEYNAR] Checking follow status for FID: ${fid}`);
      const apiKey = getConfig().neynar.apiKey.replace(/&$/, '');

      const response = await fetch(
        `https://api.neynar.com/v2/farcaster/channel/search?q=brnd&viewer_fid=${fid}`,
        {
          headers: {
            accept: 'application/json',
            api_key: apiKey,
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Neynar API error: ${response.status} ${response.statusText}`,
        );
      }

      const data = await response.json();
      console.log(`✅ [NEYNAR] Follow data retrieved:`, data);

      const channel = data?.channels[0] || [];
      const isFollowingBrndChannel =
        channel?.viewer_context?.following || false;

      console.log(`📱 [FOLLOW CHANNEL] Follow status:`, {
        isFollowingBrndChannel,
      });

      return isFollowingBrndChannel;
    } catch (error) {
      console.error('Error checking channel follow:', error);
      return false;
    }
  }

  private async checkPodiumCasts(fid: number): Promise<number> {
    try {
      console.log(`🔍 [NEYNAR] Checking podium casts for FID: ${fid}`);
      const apiKey = getConfig().neynar.apiKey.replace(/&$/, '');

      const responseCasts = await fetch(
        `https://api.neynar.com/v2/farcaster/feed/user/casts?fid=${fid}&channel_id=brnd&include_replies=false`,
        {
          headers: {
            accept: 'application/json',
            api_key: apiKey,
          },
        },
      );

      if (!responseCasts.ok) {
        throw new Error(
          `Neynar API error: ${responseCasts.status} ${responseCasts.statusText}`,
        );
      }

      const dataCasts = await responseCasts.json();
      console.log(`✅ [NEYNAR] Casts data retrieved:`);

      const casts = dataCasts?.casts || [];
      const podiumCasts = casts.filter(
        (cast) =>
          Array.isArray(cast.embeds) &&
          cast.embeds.some(
            (embed) =>
              typeof embed.url === 'string' &&
              embed.url.includes('https://brnd.land?voteId='),
          ),
      );
      const podiumCastsCount = podiumCasts.length;

      console.log(`✅ [NEYNAR] Podium casts count:`, podiumCastsCount);

      return podiumCastsCount;
    } catch (error) {
      console.error('Error checking podium casts:', error);
      return 0;
    }
  }

  private async calculateChannelInteractionMultiplier(fid: number): Promise<{
    multiplier: number;
    isFollowingChannel: boolean;
    podiumCastsCount: number;
  }> {
    try {
      // Execute both checks in parallel
      const [isFollowingChannel, podiumCastsCount] = await Promise.all([
        this.checkChannelFollow(fid),
        this.checkPodiumCasts(fid),
      ]);

      // Apply multiplier logic according to spec
      let multiplier = 1.0;
      if (podiumCastsCount >= 1 && isFollowingChannel) {
        multiplier = 1.4; // Follow + Publish podium
      } else if (isFollowingChannel) {
        multiplier = 1.2; // Follow channel only
      }

      console.log(`📱 [CHANNEL INTERACTION] Multiplier calculation:`, {
        isFollowingChannel,
        podiumCastsCount,
        multiplier,
        logic:
          podiumCastsCount >= 1 && isFollowingChannel
            ? 'Follow + Publish podium (1.4x)'
            : isFollowingChannel
              ? 'Follow channel only (1.2x)'
              : 'No interaction (1.0x)',
      });

      return { multiplier, isFollowingChannel, podiumCastsCount };
    } catch (error) {
      console.error('Error calculating channel interaction multiplier:', error);
      return {
        multiplier: 1.0,
        isFollowingChannel: false,
        podiumCastsCount: 0,
      };
    }
  }

  private async calculateHoldingMultiplier(fid: number): Promise<{
    multiplier: number;
    totalBalance: number;
    walletBalance: number;
    stakedBalance: number;
  }> {
    try {
      console.log(`💰 [BRND HOLDINGS] Checking token holdings for FID: ${fid}`);

      // Get user's verified addresses from Neynar
      const userInfo = await this.getNeynarUserInfo(fid);
      if (!userInfo?.verified_addresses?.eth_addresses) {
        console.log(
          `❌ [BRND HOLDINGS] No verified ETH addresses found for FID: ${fid}`,
        );
        return {
          multiplier: 1.0,
          totalBalance: 0,
          walletBalance: 0,
          stakedBalance: 0,
        };
      }

      const ethAddresses = userInfo.verified_addresses.eth_addresses;
      console.log(
        `🔍 [BRND HOLDINGS] Found ${ethAddresses.length} verified ETH addresses:`,
        ethAddresses,
      );

      // Check BRND wallet balance and staked balance for each address in parallel
      const balancePromises = ethAddresses.map(async (address) => {
        const [walletBalance, stakedBalance] = await Promise.all([
          this.getBrndBalance(address),
          this.getStakedBrndBalance(address),
        ]);
        return { walletBalance, stakedBalance };
      });

      const addressBalances = await Promise.all(balancePromises);

      // Sum all wallet and staked balances
      const totalWalletBalance = addressBalances.reduce(
        (sum, balance) => sum + balance.walletBalance,
        0,
      );
      const totalStakedBalance = addressBalances.reduce(
        (sum, balance) => sum + balance.stakedBalance,
        0,
      );
      const totalBalance = totalWalletBalance + totalStakedBalance;

      console.log(`💰 [BRND HOLDINGS] Balance breakdown:`, {
        walletBalance: totalWalletBalance.toLocaleString(),
        stakedBalance: totalStakedBalance.toLocaleString(),
        totalBalance: totalBalance.toLocaleString(),
      });

      // Apply multiplier based on total holdings (wallet + staked) according to spec
      let multiplier = 1.0;
      let tier = 'No holdings';

      if (totalBalance >= 800_000_000) {
        multiplier = 1.8;
        tier = '800M+ BRND (1.8x)';
      } else if (totalBalance >= 400_000_000) {
        multiplier = 1.6;
        tier = '400M+ BRND (1.6x)';
      } else if (totalBalance >= 200_000_000) {
        multiplier = 1.4;
        tier = '200M+ BRND (1.4x)';
      } else if (totalBalance >= 100_000_000) {
        multiplier = 1.2;
        tier = '100M+ BRND (1.2x)';
      }

      console.log(`💰 [BRND HOLDINGS] Multiplier calculation:`, {
        totalBalance: totalBalance.toLocaleString(),
        walletBalance: totalWalletBalance.toLocaleString(),
        stakedBalance: totalStakedBalance.toLocaleString(),
        multiplier,
        tier,
        logic: `Holding ${totalBalance.toLocaleString()} BRND tokens (${totalWalletBalance.toLocaleString()} wallet + ${totalStakedBalance.toLocaleString()} staked)`,
      });

      return {
        multiplier,
        totalBalance,
        walletBalance: totalWalletBalance,
        stakedBalance: totalStakedBalance,
      };
    } catch (error) {
      console.error('Error calculating holdings multiplier:', error);
      return {
        multiplier: 1.0,
        totalBalance: 0,
        walletBalance: 0,
        stakedBalance: 0,
      };
    }
  }

  private async getBrndBalance(address: string): Promise<number> {
    try {
      console.log(
        `🔍 [BLOCKCHAIN] Checking BRND balance for address: ${address}`,
      );

      const BRND_CONTRACT = '0x41Ed0311640A5e489A90940b1c33433501a21B07';
      const appConfig = getConfig();
      const BASE_RPC_URL = appConfig.blockchain.baseRpcUrl;

      // Encode balanceOf call - function selector + padded address
      const functionSelector = '0x70a08231'; // balanceOf(address)
      const paddedAddress = address.slice(2).padStart(64, '0'); // Remove 0x and pad to 64 chars
      const data = functionSelector + paddedAddress;

      const response = await fetch(BASE_RPC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [
            {
              to: BRND_CONTRACT,
              data: data,
            },
            'latest',
          ],
          id: 1,
        }),
      });

      if (!response.ok) {
        throw new Error(`RPC error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      if (result.error) {
        throw new Error(`RPC call error: ${result.error.message}`);
      }

      // Convert hex result to number (BRND has 18 decimals)
      const balanceHex = result.result;
      const balanceWei = BigInt(balanceHex);
      const balance = Number(balanceWei) / Math.pow(10, 18);

      console.log(
        `💰 [BLOCKCHAIN] Address ${address} BRND balance: ${balance.toLocaleString()}`,
      );
      return balance;
    } catch (error) {
      console.error(`Error getting BRND balance for ${address}:`, error);
      return 0;
    }
  }

  private async getStakedBrndBalance(address: string): Promise<number> {
    try {
      console.log(
        `🥩 [STAKING] Checking staked BRND balance for address: ${address}`,
      );

      const TELLER_VAULT = '0x19d1872d8328b23a219e11d3d6eeee1954a88f88';
      const appConfig = getConfig();
      const BASE_RPC_URL = appConfig.blockchain.baseRpcUrl;

      // Step 1: Get vault shares balance (balanceOf on vault contract)
      const functionSelector = '0x70a08231'; // balanceOf(address)
      const paddedAddress = address.slice(2).padStart(64, '0'); // Remove 0x and pad to 64 chars
      const sharesData = functionSelector + paddedAddress;

      const sharesResponse = await fetch(BASE_RPC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [
            {
              to: TELLER_VAULT,
              data: sharesData,
            },
            'latest',
          ],
          id: 1,
        }),
      });

      if (!sharesResponse.ok) {
        throw new Error(
          `RPC error: ${sharesResponse.status} ${sharesResponse.statusText}`,
        );
      }

      const sharesResult = await sharesResponse.json();

      if (sharesResult.error) {
        throw new Error(`RPC call error: ${sharesResult.error.message}`);
      }

      const sharesHex = sharesResult.result;
      const sharesBigInt = BigInt(sharesHex);

      // If no shares, return 0
      if (sharesBigInt === 0n) {
        console.log(`🥩 [STAKING] Address ${address} has no vault shares`);
        return 0;
      }

      // Step 2: Convert shares to assets using convertToAssets
      const convertToAssetsSelector = '0x07a2d13a'; // convertToAssets(uint256)
      const paddedShares = sharesHex.slice(2).padStart(64, '0'); // Remove 0x and pad to 64 chars
      const convertData = convertToAssetsSelector + paddedShares;

      const assetsResponse = await fetch(BASE_RPC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [
            {
              to: TELLER_VAULT,
              data: convertData,
            },
            'latest',
          ],
          id: 2,
        }),
      });

      if (!assetsResponse.ok) {
        throw new Error(
          `RPC error: ${assetsResponse.status} ${assetsResponse.statusText}`,
        );
      }

      const assetsResult = await assetsResponse.json();

      if (assetsResult.error) {
        throw new Error(`RPC call error: ${assetsResult.error.message}`);
      }

      // Convert hex result to number (BRND has 18 decimals)
      const assetsHex = assetsResult.result;
      const assetsBigInt = BigInt(assetsHex);
      const stakedBalance = Number(assetsBigInt) / Math.pow(10, 18);

      console.log(
        `🥩 [STAKING] Address ${address} staked BRND balance: ${stakedBalance.toLocaleString()}`,
      );
      return stakedBalance;
    } catch (error) {
      console.error(`Error getting staked BRND balance for ${address}:`, error);
      return 0;
    }
  }

  private async calculateCollectiblesMultiplier(fid: number): Promise<{
    multiplier: number;
    collectiblesCount: number;
  }> {
    try {
      console.log(`🎨 [COLLECTIBLES] Checking collectibles for FID: ${fid}`);

      // TODO: Implement collectibles checking logic
      // This would involve checking for collected BRND casts
      const collectiblesCount = 0;

      let multiplier = 1.0;
      let tier = 'No collectibles';

      if (collectiblesCount >= 3) {
        multiplier = 1.8;
        tier = '3+ collectibles (1.8x)';
      } else if (collectiblesCount >= 2) {
        multiplier = 1.4;
        tier = '2 collectibles (1.4x)';
      } else if (collectiblesCount >= 1) {
        multiplier = 1.2;
        tier = '1 collectible (1.2x)';
      }

      console.log(`🎨 [COLLECTIBLES] Multiplier calculation:`, {
        collectiblesCount,
        multiplier,
        tier,
        logic: `Collected ${collectiblesCount} BRND cast collectibles`,
      });

      return { multiplier, collectiblesCount };
    } catch (error) {
      console.error('Error calculating collectibles multiplier:', error);
      return { multiplier: 1.0, collectiblesCount: 0 };
    }
  }

  private async calculateVotedBrandsMultiplier(fid: number): Promise<{
    multiplier: number;
    votedBrandsCount: number;
  }> {
    try {
      console.log(`🗳️ [VOTED BRANDS] Checking voted brands for FID: ${fid}`);

      const votedBrandsCount = await this.getVotedBrandsCount(fid);
      console.log(
        `📊 [VOTED BRANDS] User has voted for ${votedBrandsCount} unique brands`,
      );

      let multiplier = 1.0;
      let tier = 'No votes';

      if (votedBrandsCount >= 72) {
        multiplier = 1.8;
        tier = '72+ brands (1.8x)';
      } else if (votedBrandsCount >= 36) {
        multiplier = 1.6;
        tier = '36+ brands (1.6x)';
      } else if (votedBrandsCount >= 18) {
        multiplier = 1.4;
        tier = '18+ brands (1.4x)';
      } else if (votedBrandsCount >= 9) {
        multiplier = 1.2;
        tier = '9+ brands (1.2x)';
      }

      console.log(`🗳️ [VOTED BRANDS] Multiplier calculation:`, {
        votedBrandsCount,
        multiplier,
        tier,
        logic: `Voted for ${votedBrandsCount} unique brands`,
      });

      return { multiplier, votedBrandsCount };
    } catch (error) {
      console.error('Error calculating voted brands multiplier:', error);
      return { multiplier: 1.0, votedBrandsCount: 0 };
    }
  }

  private async calculateSharedPodiumsMultiplier(fid: number): Promise<{
    multiplier: number;
    sharedPodiumsCount: number;
  }> {
    try {
      console.log(
        `📤 [SHARED PODIUMS] Checking shared podiums for FID: ${fid}`,
      );

      // Query for shared podiums from UserBrandVotes
      const sharedPodiumsCount = await this.getSharedPodiumsCount(fid);
      console.log(
        `📤 [SHARED PODIUMS] Found ${sharedPodiumsCount} shared podiums`,
      );

      let multiplier = 1.0;
      let tier = 'No shared podiums';

      if (sharedPodiumsCount >= 80) {
        multiplier = 1.8;
        tier = '80+ podiums (1.8x)';
      } else if (sharedPodiumsCount >= 40) {
        multiplier = 1.6;
        tier = '40+ podiums (1.6x)';
      } else if (sharedPodiumsCount >= 20) {
        multiplier = 1.4;
        tier = '20+ podiums (1.4x)';
      } else if (sharedPodiumsCount >= 10) {
        multiplier = 1.2;
        tier = '10+ podiums (1.2x)';
      }

      console.log(`📤 [SHARED PODIUMS] Multiplier calculation:`, {
        sharedPodiumsCount,
        multiplier,
        tier,
        logic: `Shared ${sharedPodiumsCount} podiums with castHash`,
      });

      return { multiplier, sharedPodiumsCount };
    } catch (error) {
      console.error('Error calculating shared podiums multiplier:', error);
      return { multiplier: 1.0, sharedPodiumsCount: 0 };
    }
  }

  private async calculateNeynarScoreMultiplier(fid: number): Promise<{
    multiplier: number;
    neynarScore: number;
    hasPowerBadge: boolean;
  }> {
    try {
      console.log(`⭐ [NEYNAR SCORE] Checking Neynar score for FID: ${fid}`);

      const userInfo = await this.getNeynarUserInfo(fid);
      const hasPowerBadge = userInfo?.power_badge || false;
      const neynarScore = hasPowerBadge ? 1.0 : 0.8;

      console.log(
        `🎖️ [NEYNAR SCORE] User power badge: ${hasPowerBadge}, score: ${neynarScore}`,
      );

      let multiplier = 1.0;
      let tier = 'Low score';

      if (neynarScore >= 1.0) {
        multiplier = 1.8;
        tier = '1.0+ score (1.8x)';
      } else if (neynarScore >= 0.9) {
        multiplier = 1.5;
        tier = '0.9+ score (1.5x)';
      } else if (neynarScore >= 0.85) {
        multiplier = 1.2;
        tier = '0.85+ score (1.2x)';
      }

      console.log(`⭐ [NEYNAR SCORE] Multiplier calculation:`, {
        neynarScore,
        hasPowerBadge,
        multiplier,
        tier,
        logic: `Neynar score: ${neynarScore} (Power badge: ${hasPowerBadge})`,
      });

      return { multiplier, neynarScore, hasPowerBadge };
    } catch (error) {
      console.error('Error calculating Neynar score multiplier:', error);
      return { multiplier: 1.0, neynarScore: 0, hasPowerBadge: false };
    }
  }

  private async calculateProUserMultiplier(fid: number): Promise<{
    multiplier: number;
    isProUser: boolean;
    hasBrndTokenInProfile: boolean;
  }> {
    try {
      console.log(`👑 [PRO USER] Checking Pro User status for FID: ${fid}`);

      // Get user info from Neynar to check Pro status and profile
      const userInfo = await this.getNeynarUserInfo(fid);

      if (!userInfo) {
        console.log(`👑 [PRO USER] No user info found for FID: ${fid}`);
        return {
          multiplier: 1.0,
          isProUser: false,
          hasBrndTokenInProfile: false,
        };
      }

      // Check if user has Pro subscription
      const isProUser =
        userInfo.pro?.status === 'subscribed' &&
        userInfo.pro?.expires_at &&
        new Date(userInfo.pro.expires_at) > new Date();

      // Check if user has BRND token in their profile bio
      const profileBio = userInfo.profile?.bio?.text || '';
      const hasBrndTokenInProfile = false;

      console.log(`👑 [PRO USER] User Pro status:`, {
        pro: userInfo.pro,
        isProUser,
        profileBio,
        hasBrndTokenInProfile,
      });

      let multiplier = 1.0;
      let tier = 'Not Pro User';

      if (isProUser && hasBrndTokenInProfile) {
        multiplier = 1.4;
        tier = 'Pro + BRND in profile (1.4x)';
      } else if (isProUser) {
        multiplier = 1.2;
        tier = 'Pro User only (1.2x)';
      }

      console.log(`👑 [PRO USER] Multiplier calculation:`, {
        isProUser,
        hasBrndTokenInProfile,
        multiplier,
        tier,
        logic:
          isProUser && hasBrndTokenInProfile
            ? 'Pro User with BRND in profile'
            : isProUser
              ? 'Pro User without BRND in profile'
              : 'Not Pro User',
      });

      return { multiplier, isProUser, hasBrndTokenInProfile };
    } catch (error) {
      console.error('Error calculating Pro User multiplier:', error);
      return {
        multiplier: 1.0,
        isProUser: false,
        hasBrndTokenInProfile: false,
      };
    }
  }

  private async calculateMultipliersWithBreakdown(fid: number): Promise<{
    multipliers: AirdropMultipliers;
    challenges: ChallengeBreakdown[];
  }> {
    console.log(
      `🧮 [MULTIPLIERS] Starting parallel multiplier calculation for FID: ${fid}`,
    );

    // Execute all multiplier calculations in parallel
    const [
      followAccountsResult,
      channelInteractionResult,
      holdingResult,
      collectiblesResult,
      votedBrandsResult,
      sharedPodiumsResult,
      neynarScoreResult,
      proUserResult,
    ] = await Promise.all([
      this.calculateFollowAccountsMultiplier(fid),
      this.calculateChannelInteractionMultiplier(fid),
      this.calculateHoldingMultiplier(fid),
      this.calculateCollectiblesMultiplier(fid),
      this.calculateVotedBrandsMultiplier(fid),
      this.calculateSharedPodiumsMultiplier(fid),
      this.calculateNeynarScoreMultiplier(fid),
      this.calculateProUserMultiplier(fid),
    ]);

    console.log(`✅ [MULTIPLIERS] All parallel calculations completed`);

    // Build challenges array
    const challenges: ChallengeBreakdown[] = [
      // Follow Accounts Challenge
      {
        name: 'Follow Accounts',
        description: 'Follow @brnd + @floc accounts',
        currentValue: followAccountsResult.followedCount,
        currentMultiplier: followAccountsResult.multiplier,
        maxMultiplier: 1.4,
        completed: followAccountsResult.followedCount >= 2,
        progress: {
          current: followAccountsResult.followedCount,
          required: 2,
          unit: 'following',
        },
        tiers: [
          {
            requirement: 1,
            multiplier: 1.2,
            achieved: followAccountsResult.followedCount >= 1,
          },
          {
            requirement: 2,
            multiplier: 1.4,
            achieved: followAccountsResult.followedCount >= 2,
          },
        ],
        details: {
          accounts: [
            {
              name: '@brnd',
              fid: 1108951,
              followed: followAccountsResult.details.followingBrnd,
              required: true,
            },
            {
              name: '@floc',
              fid: 6946,
              followed: followAccountsResult.details.followingFloc,
              required: true,
            },
          ],
          summary: `${followAccountsResult.followedCount}/2 accounts followed`,
        },
      },

      // Channel Interaction Challenge
      {
        name: 'Channel Interaction /brnd',
        description: 'Follow channel + Publish podiums',
        currentValue: channelInteractionResult.podiumCastsCount,
        currentMultiplier: channelInteractionResult.multiplier,
        maxMultiplier: 1.4,
        completed:
          channelInteractionResult.podiumCastsCount >= 1 &&
          channelInteractionResult.isFollowingChannel,
        progress: {
          current: channelInteractionResult.podiumCastsCount,
          required: 1,
          unit: 'podiums',
        },
        tiers: [
          {
            requirement: 1,
            multiplier: 1.2,
            achieved: channelInteractionResult.isFollowingChannel,
          },
          {
            requirement: 2,
            multiplier: 1.4,
            achieved:
              channelInteractionResult.podiumCastsCount >= 1 &&
              channelInteractionResult.isFollowingChannel,
          },
        ],
        details: {
          channelFollow: {
            channel: '/brnd',
            followed: channelInteractionResult.isFollowingChannel,
            required: true,
          },
          podiumCasts: {
            count: channelInteractionResult.podiumCastsCount,
            required: 1,
            description: 'Publish podium casts in /brnd channel',
          },
          summary: `Channel followed: ${channelInteractionResult.isFollowingChannel ? 'Yes' : 'No'}, Podiums published: ${channelInteractionResult.podiumCastsCount}`,
        },
      },

      // BRND Holdings Challenge
      {
        name: 'Holding $BRND',
        description: 'Hold $BRND',
        currentValue: holdingResult.totalBalance,
        currentMultiplier: holdingResult.multiplier,
        maxMultiplier: 1.8,
        completed: holdingResult.totalBalance >= 800_000_000,
        progress: {
          current: holdingResult.totalBalance,
          required: 800_000_000,
          unit: '$BRND',
        },
        tiers: [
          {
            requirement: 100_000_000,
            multiplier: 1.2,
            achieved: holdingResult.totalBalance >= 100_000_000,
          },
          {
            requirement: 200_000_000,
            multiplier: 1.4,
            achieved: holdingResult.totalBalance >= 200_000_000,
          },
          {
            requirement: 400_000_000,
            multiplier: 1.6,
            achieved: holdingResult.totalBalance >= 400_000_000,
          },
          {
            requirement: 800_000_000,
            multiplier: 1.8,
            achieved: holdingResult.totalBalance >= 800_000_000,
          },
        ],
        details: {
          totalBalance: holdingResult.totalBalance,
          walletBalance: holdingResult.walletBalance,
          stakedBalance: holdingResult.stakedBalance,
          formattedBalance: holdingResult.totalBalance.toLocaleString(),
          formattedWalletBalance: holdingResult.walletBalance.toLocaleString(),
          formattedStakedBalance: holdingResult.stakedBalance.toLocaleString(),
          nextTier:
            holdingResult.totalBalance >= 800_000_000
              ? null
              : holdingResult.totalBalance >= 400_000_000
                ? { requirement: 800_000_000, multiplier: 1.8 }
                : holdingResult.totalBalance >= 200_000_000
                  ? { requirement: 400_000_000, multiplier: 1.6 }
                  : holdingResult.totalBalance >= 100_000_000
                    ? { requirement: 200_000_000, multiplier: 1.4 }
                    : { requirement: 100_000_000, multiplier: 1.2 },
          summary: `Holding ${holdingResult.totalBalance.toLocaleString()} BRND tokens (${holdingResult.walletBalance.toLocaleString()} wallet + ${holdingResult.stakedBalance.toLocaleString()} staked)`,
        },
      },

      // Collectibles Challenge
      {
        name: 'Collect @brndbot casts',
        description: 'Collect @brndbot casts',
        currentValue: collectiblesResult.collectiblesCount,
        currentMultiplier: collectiblesResult.multiplier,
        maxMultiplier: 1.8,
        completed: collectiblesResult.collectiblesCount >= 3,
        progress: {
          current: collectiblesResult.collectiblesCount,
          required: 3,
          unit: 'collectibles',
        },
        tiers: [
          {
            requirement: 1,
            multiplier: 1.2,
            achieved: collectiblesResult.collectiblesCount >= 1,
          },
          {
            requirement: 2,
            multiplier: 1.4,
            achieved: collectiblesResult.collectiblesCount >= 2,
          },
          {
            requirement: 3,
            multiplier: 1.8,
            achieved: collectiblesResult.collectiblesCount >= 3,
          },
        ],
      },

      // Voted Brands Challenge
      {
        name: '# of different brands voted',
        description: 'Vote for different brands',
        currentValue: votedBrandsResult.votedBrandsCount,
        currentMultiplier: votedBrandsResult.multiplier,
        maxMultiplier: 1.8,
        completed: votedBrandsResult.votedBrandsCount >= 72,
        progress: {
          current: votedBrandsResult.votedBrandsCount,
          required: 72,
          unit: 'brands',
        },
        tiers: [
          {
            requirement: 9,
            multiplier: 1.2,
            achieved: votedBrandsResult.votedBrandsCount >= 9,
          },
          {
            requirement: 18,
            multiplier: 1.4,
            achieved: votedBrandsResult.votedBrandsCount >= 18,
          },
          {
            requirement: 36,
            multiplier: 1.6,
            achieved: votedBrandsResult.votedBrandsCount >= 36,
          },
          {
            requirement: 72,
            multiplier: 1.8,
            achieved: votedBrandsResult.votedBrandsCount >= 72,
          },
        ],
        details: {
          uniqueBrandsVoted: votedBrandsResult.votedBrandsCount,
          nextTier:
            votedBrandsResult.votedBrandsCount >= 72
              ? null
              : votedBrandsResult.votedBrandsCount >= 36
                ? { requirement: 72, multiplier: 1.8 }
                : votedBrandsResult.votedBrandsCount >= 18
                  ? { requirement: 36, multiplier: 1.6 }
                  : votedBrandsResult.votedBrandsCount >= 9
                    ? { requirement: 18, multiplier: 1.4 }
                    : { requirement: 9, multiplier: 1.2 },
          summary: `Voted for ${votedBrandsResult.votedBrandsCount} unique brands`,
        },
      },

      // Shared Podiums Challenge
      {
        name: 'Podiums Shared',
        description: 'Shared podiums',
        currentValue: sharedPodiumsResult.sharedPodiumsCount,
        currentMultiplier: sharedPodiumsResult.multiplier,
        maxMultiplier: 1.8,
        completed: sharedPodiumsResult.sharedPodiumsCount >= 80,
        progress: {
          current: sharedPodiumsResult.sharedPodiumsCount,
          required: 80,
          unit: 'podiums',
        },
        tiers: [
          {
            requirement: 10,
            multiplier: 1.2,
            achieved: sharedPodiumsResult.sharedPodiumsCount >= 10,
          },
          {
            requirement: 20,
            multiplier: 1.4,
            achieved: sharedPodiumsResult.sharedPodiumsCount >= 20,
          },
          {
            requirement: 40,
            multiplier: 1.6,
            achieved: sharedPodiumsResult.sharedPodiumsCount >= 40,
          },
          {
            requirement: 80,
            multiplier: 1.8,
            achieved: sharedPodiumsResult.sharedPodiumsCount >= 80,
          },
        ],
        details: {
          sharedPodiumsCount: sharedPodiumsResult.sharedPodiumsCount,
          nextTier:
            sharedPodiumsResult.sharedPodiumsCount >= 80
              ? null
              : sharedPodiumsResult.sharedPodiumsCount >= 40
                ? { requirement: 80, multiplier: 1.8 }
                : sharedPodiumsResult.sharedPodiumsCount >= 20
                  ? { requirement: 40, multiplier: 1.6 }
                  : sharedPodiumsResult.sharedPodiumsCount >= 10
                    ? { requirement: 20, multiplier: 1.4 }
                    : { requirement: 10, multiplier: 1.2 },
          summary: `Shared ${sharedPodiumsResult.sharedPodiumsCount} podiums with castHash`,
        },
      },

      // Neynar Score Challenge
      {
        name: 'Neynar Score',
        description: 'Score de reputación en Neynar',
        currentValue: neynarScoreResult.neynarScore,
        currentMultiplier: neynarScoreResult.multiplier,
        maxMultiplier: 1.8,
        completed: neynarScoreResult.neynarScore >= 1.0,
        progress: {
          current: neynarScoreResult.neynarScore,
          required: 1.0,
          unit: 'score',
        },
        tiers: [
          {
            requirement: 0.85,
            multiplier: 1.2,
            achieved: neynarScoreResult.neynarScore >= 0.85,
          },
          {
            requirement: 0.9,
            multiplier: 1.5,
            achieved: neynarScoreResult.neynarScore >= 0.9,
          },
          {
            requirement: 1.0,
            multiplier: 1.8,
            achieved: neynarScoreResult.neynarScore >= 1.0,
          },
        ],
        details: {
          neynarScore: neynarScoreResult.neynarScore,
          hasPowerBadge: neynarScoreResult.hasPowerBadge,
          nextTier:
            neynarScoreResult.neynarScore >= 1.0
              ? null
              : neynarScoreResult.neynarScore >= 0.9
                ? { requirement: 1.0, multiplier: 1.8 }
                : neynarScoreResult.neynarScore >= 0.85
                  ? { requirement: 0.9, multiplier: 1.5 }
                  : { requirement: 0.85, multiplier: 1.2 },
          summary: `Neynar score: ${neynarScoreResult.neynarScore} (Power badge: ${neynarScoreResult.hasPowerBadge ? 'Yes' : 'No'})`,
        },
      },

      // Pro User Challenge
      {
        name: 'Pro User',
        description: 'Pro User',
        currentValue: proUserResult.isProUser ? 1 : 0,
        currentMultiplier: proUserResult.multiplier,
        maxMultiplier: 1.4,
        completed: proUserResult.isProUser,
        progress: {
          current: proUserResult.isProUser ? 1 : 0,
          required: 1,
          unit: 'is pro',
        },
        tiers: [
          {
            requirement: 1,
            multiplier: 1.2,
            achieved: proUserResult.isProUser,
          },
          {
            requirement: 2,
            multiplier: 1.4,
            achieved: proUserResult.isProUser,
          },
        ],
        details: {
          isProUser: proUserResult.isProUser,
          nextTier: proUserResult.isProUser,
          summary: `Pro User: ${proUserResult.isProUser ? 'Yes' : 'No'}`,
        },
      },
    ];

    const multipliers: AirdropMultipliers = {
      followAccounts: followAccountsResult.multiplier,
      channelInteraction: channelInteractionResult.multiplier,
      holdingBrnd: holdingResult.multiplier,
      collectibles: collectiblesResult.multiplier,
      votedBrands: votedBrandsResult.multiplier,
      sharedPodiums: sharedPodiumsResult.multiplier,
      neynarScore: neynarScoreResult.multiplier,
      proUser: proUserResult.multiplier,
    };

    console.log(`📋 [MULTIPLIERS] Final multipliers summary:`, multipliers);
    console.log(`🧮 [MULTIPLIERS] Parallel multiplier calculation complete!`);

    return { multipliers, challenges };
  }

  private async getVotedBrandsCount(fid: number): Promise<number> {
    try {
      console.log(`📊 [VOTES] Getting voted brands count for FID: ${fid}`);

      const user = await this.userRepository.findOne({
        where: { fid },
        relations: [
          'userBrandVotes',
          'userBrandVotes.brand1',
          'userBrandVotes.brand2',
          'userBrandVotes.brand3',
        ],
      });

      if (!user || !user.userBrandVotes) {
        console.log(`📊 [VOTES] No votes found for user ${fid}`);
        return 0;
      }

      console.log(
        `📊 [VOTES] Found ${user.userBrandVotes.length} vote records for user ${fid}`,
      );

      // Collect all unique brand IDs from all three brand positions in each vote
      const uniqueBrands = new Set<number>();

      user.userBrandVotes.forEach((vote) => {
        if (vote.brand1?.id) uniqueBrands.add(vote.brand1.id);
        if (vote.brand2?.id) uniqueBrands.add(vote.brand2.id);
        if (vote.brand3?.id) uniqueBrands.add(vote.brand3.id);
      });

      console.log(
        `📊 [VOTES] User has voted for ${uniqueBrands.size} unique brands`,
      );
      console.log(`📊 [VOTES] Unique brand IDs:`, Array.from(uniqueBrands));

      return uniqueBrands.size;
    } catch (error) {
      console.error('Error getting voted brands count:', error);
      return 0;
    }
  }

  private async getSharedPodiumsCount(fid: number): Promise<number> {
    try {
      console.log(
        `📤 [SHARED PODIUMS] Getting shared podiums count for FID: ${fid}`,
      );

      const user = await this.userRepository.findOne({
        where: { fid },
        relations: ['userBrandVotes'],
      });

      if (!user || !user.userBrandVotes) {
        console.log(`📤 [SHARED PODIUMS] No votes found for user ${fid}`);
        return 0;
      }

      // Filter votes that are shared and have a castHash
      const sharedPodiums = user.userBrandVotes.filter(
        (vote) =>
          vote.shared === true &&
          vote.castHash !== null &&
          vote.castHash !== undefined,
      );

      console.log(
        `📤 [SHARED PODIUMS] Found ${sharedPodiums.length} shared podiums for user ${fid}`,
      );
      console.log(
        `📤 [SHARED PODIUMS] Shared podium details:`,
        sharedPodiums.map((vote) => ({
          id: vote.id,
          castHash: vote.castHash,
          date: vote.date,
        })),
      );

      return sharedPodiums.length;
    } catch (error) {
      console.error('Error getting shared podiums count:', error);
      return 0;
    }
  }

  private async getUserLeaderboardPosition(
    fid: number,
    finalScore: number,
  ): Promise<number> {
    try {
      const higherScores = await this.airdropScoreRepository
        .createQueryBuilder('score')
        .where('score.finalScore > :finalScore', { finalScore })
        .getCount();
      return higherScores + 1;
    } catch (error) {
      console.error('Error getting leaderboard position:', error);
      return 0;
    }
  }

  private async saveAirdropScore(
    calculation: AirdropCalculation,
  ): Promise<void> {
    try {
      let airdropScore = await this.airdropScoreRepository.findOne({
        where: { fid: calculation.fid },
      });

      if (!airdropScore) {
        airdropScore = new AirdropScore();
        airdropScore.fid = calculation.fid;
      }

      airdropScore.basePoints = calculation.basePoints;
      airdropScore.followAccountsMultiplier =
        calculation.multipliers.followAccounts;
      airdropScore.channelInteractionMultiplier =
        calculation.multipliers.channelInteraction;
      airdropScore.holdingBrndMultiplier = calculation.multipliers.holdingBrnd;
      airdropScore.collectiblesMultiplier =
        calculation.multipliers.collectibles;
      airdropScore.votedBrandsMultiplier = calculation.multipliers.votedBrands;
      airdropScore.sharedPodiumsMultiplier =
        calculation.multipliers.sharedPodiums;
      airdropScore.neynarScoreMultiplier = calculation.multipliers.neynarScore;
      airdropScore.proUserMultiplier = calculation.multipliers.proUser;
      airdropScore.totalMultiplier = calculation.totalMultiplier;
      airdropScore.finalScore = calculation.finalScore;
      airdropScore.tokenAllocation = calculation.tokenAllocation;
      airdropScore.percentage = calculation.percentage;

      await this.airdropScoreRepository.save(airdropScore);
    } catch (error) {
      console.error('Error saving airdrop score:', error);
    }
  }

  async getLeaderboard(limit: number = 100): Promise<AirdropScore[]> {
    return this.airdropScoreRepository.find({
      relations: ['user'],
      order: {
        finalScore: 'DESC',
      },
      take: limit,
    });
  }

  async getDatabaseSummary(): Promise<{
    totalUsers: number;
    usersWithVotes: number;
    usersWithSharedPodiums: number;
    totalVotes: number;
    totalSharedPodiums: number;
    averageVotesPerUser: number;
    averageSharedPodiumsPerUser: number;
    averageBrandsVotedPerUser: number;
    existingAirdropScores: number;
    topUsersByPoints: Array<{ fid: number; username: string; points: number }>;
    topUsersByVotes: Array<{
      fid: number;
      username: string;
      votesCount: number;
    }>;
    topUsersBySharedPodiums: Array<{
      fid: number;
      username: string;
      sharedPodiumsCount: number;
    }>;
  }> {
    console.log(`📊 [DATABASE SUMMARY] Generating database summary...`);

    // Get total users
    const totalUsers = await this.userRepository.count();
    console.log(`👥 [DATABASE SUMMARY] Total users: ${totalUsers}`);

    // Get users with votes
    const usersWithVotes = await this.userRepository
      .createQueryBuilder('user')
      .innerJoin('user.userBrandVotes', 'votes')
      .getCount();
    console.log(`🗳️ [DATABASE SUMMARY] Users with votes: ${usersWithVotes}`);

    // Get users with shared podiums
    const usersWithSharedPodiums = await this.userRepository
      .createQueryBuilder('user')
      .innerJoin('user.userBrandVotes', 'votes')
      .where('votes.shared = :shared', { shared: true })
      .andWhere('votes.castHash IS NOT NULL')
      .getCount();
    console.log(
      `📤 [DATABASE SUMMARY] Users with shared podiums: ${usersWithSharedPodiums}`,
    );

    // Get total votes count
    const totalVotesResult = await this.userRepository.query(`
      SELECT COUNT(*) as total FROM user_brand_votes
    `);
    const totalVotes = parseInt(totalVotesResult[0]?.total || '0');
    console.log(`📊 [DATABASE SUMMARY] Total votes: ${totalVotes}`);

    // Get total shared podiums count
    const totalSharedPodiumsResult = await this.userRepository.query(`
      SELECT COUNT(*) as total FROM user_brand_votes 
      WHERE shared = true AND castHash IS NOT NULL
    `);
    const totalSharedPodiums = parseInt(
      totalSharedPodiumsResult[0]?.total || '0',
    );
    console.log(
      `📤 [DATABASE SUMMARY] Total shared podiums: ${totalSharedPodiums}`,
    );

    // Calculate averages
    const averageVotesPerUser = totalUsers > 0 ? totalVotes / totalUsers : 0;
    const averageSharedPodiumsPerUser =
      totalUsers > 0 ? totalSharedPodiums / totalUsers : 0;

    // Get average unique brands voted per user
    const brandsVotedResult = await this.userRepository.query(`
      SELECT AVG(unique_brands) as avg_brands FROM (
        SELECT 
          u.fid,
          COUNT(DISTINCT 
            CASE WHEN v.brand1Id IS NOT NULL THEN v.brand1Id END ||
            CASE WHEN v.brand2Id IS NOT NULL THEN v.brand2Id END ||
            CASE WHEN v.brand3Id IS NOT NULL THEN v.brand3Id END
          ) as unique_brands
        FROM users u
        LEFT JOIN user_brand_votes v ON u.id = v.userId
        GROUP BY u.fid
      ) subquery
    `);
    const averageBrandsVotedPerUser = parseFloat(
      brandsVotedResult[0]?.avg_brands || '0',
    );

    // Get existing airdrop scores count
    const existingAirdropScores = await this.airdropScoreRepository.count();
    console.log(
      `🏆 [DATABASE SUMMARY] Existing airdrop scores: ${existingAirdropScores}`,
    );

    // Get top users by points
    const topUsersByPoints = await this.userRepository.find({
      select: ['fid', 'username', 'points'],
      order: { points: 'DESC' },
      take: 10,
    });

    // Get top users by votes count
    const topUsersByVotesResult = await this.userRepository.query(`
      SELECT u.fid, u.username, COUNT(v.id) as votesCount
      FROM users u
      LEFT JOIN user_brand_votes v ON u.id = v.userId
      GROUP BY u.fid, u.username
      ORDER BY votesCount DESC
      LIMIT 10
    `);
    const topUsersByVotes = topUsersByVotesResult.map((row) => ({
      fid: row.fid,
      username: row.username,
      votesCount: parseInt(row.votesCount),
    }));

    // Get top users by shared podiums
    const topUsersBySharedPodiumsResult = await this.userRepository.query(`
      SELECT u.fid, u.username, COUNT(v.id) as sharedPodiumsCount
      FROM users u
      LEFT JOIN user_brand_votes v ON u.id = v.userId
      WHERE v.shared = true AND v.castHash IS NOT NULL
      GROUP BY u.fid, u.username
      ORDER BY sharedPodiumsCount DESC
      LIMIT 10
    `);
    const topUsersBySharedPodiums = topUsersBySharedPodiumsResult.map(
      (row) => ({
        fid: row.fid,
        username: row.username,
        sharedPodiumsCount: parseInt(row.sharedPodiumsCount),
      }),
    );

    const summary = {
      totalUsers,
      usersWithVotes,
      usersWithSharedPodiums,
      totalVotes,
      totalSharedPodiums,
      averageVotesPerUser: Math.round(averageVotesPerUser * 100) / 100,
      averageSharedPodiumsPerUser:
        Math.round(averageSharedPodiumsPerUser * 100) / 100,
      averageBrandsVotedPerUser:
        Math.round(averageBrandsVotedPerUser * 100) / 100,
      existingAirdropScores,
      topUsersByPoints: topUsersByPoints.map((user) => ({
        fid: user.fid,
        username: user.username,
        points: user.points,
      })),
      topUsersByVotes,
      topUsersBySharedPodiums,
    };

    console.log(`📋 [DATABASE SUMMARY] Summary generated:`, summary);
    return summary;
  }

  async fixZeroScoreAllocations(): Promise<{ updatedUsers: number }> {
    console.log(`🔧 [ZERO FIX] Fixing users with 0 airdrop score...`);

    const result = await this.airdropScoreRepository
      .createQueryBuilder()
      .update()
      .set({
        tokenAllocation: 0,
        percentage: 0,
      })
      .where('finalScore = 0 OR finalScore IS NULL')
      .execute();

    console.log(
      `✅ [ZERO FIX] Fixed ${result.affected} users with zero scores`,
    );

    return { updatedUsers: result.affected || 0 };
  }

  async recalculateTokenDistribution(): Promise<{
    totalUsers: number;
    totalAirdropPoints: number;
    totalTokensAllocated: number;
    usersWithZeroScore: number;
    distributionStats: {
      under1USD: number;
      under5USD: number;
      under10USD: number;
      under20USD: number;
      over20USD: number;
      over30USD: number;
    };
  }> {
    console.log(
      `🔄 [TOKEN RECALC] Starting token distribution recalculation...`,
    );

    // STEP 1: Fix zero score allocations first
    await this.fixZeroScoreAllocations();

    // STEP 2: Get all airdrop scores with valid values
    const airdropScores = await this.airdropScoreRepository
      .createQueryBuilder('score')
      .select(['score.fid', 'score.finalScore'])
      .where('score.finalScore > 0')
      .getMany();

    console.log(
      `📊 [TOKEN RECALC] Found ${airdropScores.length} users with airdrop scores > 0`,
    );

    // Debug first few scores
    console.log(
      `🔍 [TOKEN RECALC] Sample scores:`,
      airdropScores.slice(0, 5).map((s) => ({
        fid: s.fid,
        finalScore: s.finalScore,
        type: typeof s.finalScore,
        asNumber: Number(s.finalScore),
      })),
    );

    const totalAirdropPoints = airdropScores.reduce(
      (sum, score) => sum + Number(score.finalScore),
      0,
    );
    console.log(
      `📈 [TOKEN RECALC] Total airdrop points: ${totalAirdropPoints.toLocaleString()}`,
    );

    // Update token allocations for all users
    let totalTokensAllocated = 0;
    const BRND_USD_PRICE = 0.000001365;
    const distributionStats = {
      under1USD: 0,
      under5USD: 0,
      under10USD: 0,
      under20USD: 0,
      over20USD: 0,
      over30USD: 0,
    };

    for (const score of airdropScores) {
      const finalScore = Number(score.finalScore);
      const percentage = (finalScore / totalAirdropPoints) * 100;
      const tokenAllocation = Math.round(
        (finalScore / totalAirdropPoints) * this.TOTAL_ALLOCATION,
      );
      const usdValue = tokenAllocation * BRND_USD_PRICE;

      // Validate calculations
      if (isNaN(percentage) || isNaN(tokenAllocation)) {
        console.error(
          `❌ [TOKEN RECALC] Invalid calculation for FID ${score.fid}:`,
          {
            finalScore,
            totalAirdropPoints,
            percentage,
            tokenAllocation,
          },
        );
        continue;
      }

      // Update database
      await this.airdropScoreRepository.update(
        { fid: score.fid },
        {
          tokenAllocation: tokenAllocation,
          percentage: percentage,
        },
      );

      totalTokensAllocated += tokenAllocation;

      // Categorize by USD value
      if (usdValue < 1) distributionStats.under1USD++;
      else if (usdValue < 5) distributionStats.under5USD++;
      else if (usdValue < 10) distributionStats.under10USD++;
      else if (usdValue < 20) distributionStats.under20USD++;
      else if (usdValue >= 30) distributionStats.over30USD++;
      else distributionStats.over20USD++;
    }

    // Set zero allocation for users with 0 score - do this FIRST
    console.log(
      `🔄 [TOKEN RECALC] Setting zero allocation for users with 0 score...`,
    );
    await this.airdropScoreRepository
      .createQueryBuilder()
      .update()
      .set({
        tokenAllocation: 0,
        percentage: 0,
      })
      .where('finalScore = 0')
      .execute();

    const usersWithZeroScore = await this.airdropScoreRepository
      .createQueryBuilder('score')
      .where('score.finalScore = 0')
      .getCount();

    console.log(`✅ [TOKEN RECALC] Recalculation complete!`);
    console.log(
      `💰 [TOKEN RECALC] Total tokens allocated: ${totalTokensAllocated.toLocaleString()}`,
    );
    console.log(
      `📊 [TOKEN RECALC] Users with zero score: ${usersWithZeroScore}`,
    );

    return {
      totalUsers: airdropScores.length,
      totalAirdropPoints,
      totalTokensAllocated,
      usersWithZeroScore,
      distributionStats,
    };
  }

  async getAirdropAnalytics(): Promise<{
    summary: any;
    usdDistribution: any;
    topUsers: any[];
    bottomUsers: any[];
    statistics: any;
  }> {
    console.log(`📊 [ANALYTICS] Generating airdrop analytics...`);

    const BRND_USD_PRICE = 0.000001365;

    // Get all airdrop scores with user info
    const airdropScores = await this.airdropScoreRepository.find({
      relations: ['user'],
      order: { finalScore: 'DESC' },
    });

    // Calculate USD values and statistics
    let totalTokens = 0;
    let totalUSDValue = 0;
    const usdDistribution = {
      under1USD: 0,
      between1_5USD: 0,
      between5_10USD: 0,
      between10_20USD: 0,
      between20_30USD: 0,
      over30USD: 0,
    };

    const usersWithUSD = airdropScores.map((score) => {
      const tokenAllocation = Number(score.tokenAllocation);
      const usdValue = tokenAllocation * BRND_USD_PRICE;
      totalTokens += tokenAllocation;
      totalUSDValue += usdValue;

      // Categorize
      if (usdValue < 1) usdDistribution.under1USD++;
      else if (usdValue < 5) usdDistribution.between1_5USD++;
      else if (usdValue < 10) usdDistribution.between5_10USD++;
      else if (usdValue < 20) usdDistribution.between10_20USD++;
      else if (usdValue < 30) usdDistribution.between20_30USD++;
      else usdDistribution.over30USD++;

      return {
        ...score,
        usdValue: Math.round(usdValue * 100) / 100,
      };
    });

    const topUsers = usersWithUSD.slice(0, 20);
    const bottomUsers = usersWithUSD.slice(-20).reverse();

    const summary = {
      totalUsers: airdropScores.length,
      totalTokensDistributed: totalTokens,
      totalUSDValue: Math.round(totalUSDValue * 100) / 100,
      averageTokensPerUser: Math.round(totalTokens / airdropScores.length),
      averageUSDPerUser:
        Math.round((totalUSDValue / airdropScores.length) * 100) / 100,
      brndUSDPrice: BRND_USD_PRICE,
    };

    const statistics = {
      highestAllocation: {
        tokens: Math.max(...usersWithUSD.map((u) => Number(u.tokenAllocation))),
        usd: Math.max(...usersWithUSD.map((u) => u.usdValue)),
      },
      lowestAllocation: {
        tokens: Math.min(
          ...usersWithUSD
            .filter((u) => Number(u.tokenAllocation) > 0)
            .map((u) => Number(u.tokenAllocation)),
        ),
        usd: Math.min(
          ...usersWithUSD.filter((u) => u.usdValue > 0).map((u) => u.usdValue),
        ),
      },
    };

    return {
      summary,
      usdDistribution,
      topUsers,
      bottomUsers,
      statistics,
    };
  }

  async calculateAirdropForAllUsers(batchSize: number = 10): Promise<{
    databaseSummary: any;
    eligibleUsers: number;
    totalAirdropPoints: number;
    totalTokensAllocated: number;
    processed: number;
    successful: number;
    failed: number;
    errors: Array<{ fid: number; error: string }>;
    topAirdropScores: Array<{
      fid: number;
      username: string;
      airdropScore: number;
      tokenAllocation: number;
      percentage: number;
    }>;
  }> {
    console.log(
      `🚀 [BULK AIRDROP] Starting airdrop calculation for TOP 1111 USERS by points`,
    );

    // STEP 1: Generate database summary first
    console.log(`📊 [BULK AIRDROP] STEP 1: Generating database summary...`);
    const databaseSummary = await this.getDatabaseSummary();
    console.log(`✅ [BULK AIRDROP] Database summary completed`);

    // STEP 2: Get top 1111 users by points
    console.log(
      `🏆 [BULK AIRDROP] STEP 2: Fetching top 1111 users by points...`,
    );
    const users = await this.userRepository.find({
      select: ['fid', 'username', 'points'],
      order: { points: 'DESC' },
      take: this.TOP_USERS, // 1111
    });

    console.log(
      `👑 [BULK AIRDROP] Found ${users.length} eligible users for airdrop`,
    );
    console.log(
      `📦 [BULK AIRDROP] STEP 3: Processing in batches of ${batchSize} users`,
    );

    let processed = 0;
    let successful = 0;
    let failed = 0;
    const errors: Array<{ fid: number; error: string }> = [];
    const airdropCalculations: Array<{
      fid: number;
      username: string;
      airdropScore: number;
    }> = [];

    // STEP 4: Calculate airdrop scores for all eligible users
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      console.log(
        `📦 [BULK AIRDROP] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(users.length / batchSize)} (users ${i + 1}-${Math.min(i + batchSize, users.length)})`,
      );

      for (const user of batch) {
        try {
          console.log(
            `🎯 [BULK AIRDROP] Processing user ${user.fid} (${user.username})`,
          );
          const calculation = await this.checkUserEligibility(user.fid);

          airdropCalculations.push({
            fid: user.fid,
            username: user.username,
            airdropScore: calculation.finalScore,
          });

          successful++;
          console.log(
            `✅ [BULK AIRDROP] Successfully processed user ${user.fid} - Airdrop Score: ${calculation.finalScore}`,
          );
        } catch (error) {
          console.error(
            `❌ [BULK AIRDROP] Failed to process user ${user.fid}:`,
            error,
          );
          failed++;
          errors.push({
            fid: user.fid,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        processed++;
      }

      console.log(
        `📊 [BULK AIRDROP] Batch complete. Progress: ${processed}/${users.length} (${Math.round((processed / users.length) * 100)}%)`,
      );

      // Add a small delay between batches to be nice to external APIs
      if (i + batchSize < users.length) {
        console.log(`⏳ [BULK AIRDROP] Waiting 2 seconds before next batch...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    console.log(`🏁 [BULK AIRDROP] Airdrop score calculation complete!`);
    console.log(
      `📈 [BULK AIRDROP] Summary: ${successful} successful, ${failed} failed out of ${processed} total users`,
    );

    // STEP 5: Calculate token distribution
    console.log(`💰 [BULK AIRDROP] STEP 5: Calculating token distribution...`);

    const totalAirdropPoints = airdropCalculations.reduce(
      (sum, calc) => sum + calc.airdropScore,
      0,
    );
    console.log(
      `📊 [BULK AIRDROP] Total airdrop points across all users: ${totalAirdropPoints.toLocaleString()}`,
    );

    // Update each user's airdrop score with proper token allocation
    const updatedCalculations = [];
    let totalTokensAllocated = 0;

    for (const calc of airdropCalculations) {
      const percentage = (calc.airdropScore / totalAirdropPoints) * 100;
      const tokenAllocation = Math.round(
        (calc.airdropScore / totalAirdropPoints) * this.TOTAL_ALLOCATION,
      );
      totalTokensAllocated += tokenAllocation;

      // Update the database with the correct token allocation and percentage
      await this.airdropScoreRepository.update(
        { fid: calc.fid },
        {
          tokenAllocation: tokenAllocation,
          percentage: percentage,
        },
      );

      updatedCalculations.push({
        fid: calc.fid,
        username: calc.username,
        airdropScore: calc.airdropScore,
        tokenAllocation: tokenAllocation,
        percentage: Math.round(percentage * 1000) / 1000, // Round to 3 decimal places
      });
    }

    // Sort by airdrop score descending for top list
    const topAirdropScores = updatedCalculations
      .sort((a, b) => b.airdropScore - a.airdropScore)
      .slice(0, 20); // Top 20 for summary

    console.log(`💰 [BULK AIRDROP] Token distribution complete!`);
    console.log(
      `🎯 [BULK AIRDROP] Total tokens allocated: ${totalTokensAllocated.toLocaleString()} / ${this.TOTAL_ALLOCATION.toLocaleString()}`,
    );
    console.log(
      `📊 [BULK AIRDROP] Top airdrop scorer: ${topAirdropScores[0]?.username} with ${topAirdropScores[0]?.airdropScore.toLocaleString()} points (${topAirdropScores[0]?.tokenAllocation.toLocaleString()} tokens)`,
    );

    return {
      databaseSummary,
      eligibleUsers: users.length,
      totalAirdropPoints,
      totalTokensAllocated,
      processed,
      successful,
      failed,
      errors,
      topAirdropScores,
    };
  }

  /**
   * Generates an airdrop snapshot (merkle tree) for the top 1111 users
   * Each leaf in the merkle tree is: keccak256(abi.encodePacked(fid, amount))
   * This allows FID-based claiming on the smart contract
   */
  async generateAirdropSnapshot(): Promise<{
    merkleRoot: string;
    totalUsers: number;
    totalTokens: string;
    snapshotId: number;
    treeData: any;
  }> {
    console.log('🌳 [AIRDROP SNAPSHOT] Starting snapshot generation...');

    // Get top 1111 users from leaderboard
    const topUsers = await this.getLeaderboard(this.TOP_USERS);
    console.log(
      `📊 [AIRDROP SNAPSHOT] Found ${topUsers.length} users in leaderboard`,
    );

    if (topUsers.length === 0) {
      throw new Error('No users found in leaderboard');
    }

    // Build leaves array: each leaf is keccak256(abi.encodePacked(fid, amount))
    const leaves: Array<{
      fid: number;
      amount: string;
      leaf: string;
    }> = [];

    let totalTokens = BigInt(0);

    for (const airdropScore of topUsers) {
      const fid = airdropScore.fid;
      const amount = BigInt(Math.round(Number(airdropScore.tokenAllocation)));

      // Create leaf: keccak256(abi.encodePacked(fid, amount))
      // Use ethers' solidityPackedKeccak256 to match Solidity's abi.encodePacked exactly
      const leafHash = solidityPackedKeccak256(
        ['uint256', 'uint256'],
        [BigInt(fid), amount],
      );

      leaves.push({
        fid,
        amount: amount.toString(),
        leaf: leafHash, // Already in hex format from solidityPackedKeccak256
      });

      totalTokens += amount;
    }

    console.log(
      `🌿 [AIRDROP SNAPSHOT] Created ${leaves.length} leaves, total tokens: ${totalTokens.toString()}`,
    );

    // Build merkle tree
    const leafHashes = leaves.map((l) =>
      Buffer.from(l.leaf.startsWith('0x') ? l.leaf.slice(2) : l.leaf, 'hex'),
    );
    const tree = new MerkleTree(leafHashes, keccak256, {
      sortPairs: true, // Sort pairs for consistent tree structure
    });

    const merkleRoot = '0x' + tree.getRoot().toString('hex');
    console.log(`🌳 [AIRDROP SNAPSHOT] Merkle root generated: ${merkleRoot}`);

    // Store snapshot in database
    const snapshot = this.airdropSnapshotRepository.create({
      merkleRoot,
      totalUsers: leaves.length,
      totalTokens: totalTokens.toString(),
      treeData: {
        leaves,
        // Don't store the full tree object (it's large), we can rebuild it from leaves
      },
      snapshotDate: new Date(),
    });

    const savedSnapshot = await this.airdropSnapshotRepository.save(snapshot);
    console.log(
      `💾 [AIRDROP SNAPSHOT] Snapshot saved with ID: ${savedSnapshot.id}`,
    );

    return {
      merkleRoot,
      totalUsers: leaves.length,
      totalTokens: totalTokens.toString(),
      snapshotId: savedSnapshot.id,
      treeData: {
        leaves: leaves.map((l) => ({
          fid: l.fid,
          amount: l.amount,
        })),
      },
    };
  }

  /**
   * Generates a merkle proof for a specific FID
   * Used when a user wants to claim their airdrop
   */
  async generateMerkleProof(
    fid: number,
    snapshotId?: number,
  ): Promise<{
    fid: number;
    amount: string;
    proof: string[];
    merkleRoot: string;
    snapshotId: number;
  } | null> {
    console.log(
      `🔍 [MERKLE PROOF] Generating proof for FID: ${fid}, snapshotId: ${snapshotId || 'latest'}`,
    );

    // Get the latest snapshot if no snapshotId provided
    let snapshot: AirdropSnapshot;
    if (snapshotId) {
      snapshot = await this.airdropSnapshotRepository.findOne({
        where: { id: snapshotId },
      });
    } else {
      snapshot = await this.airdropSnapshotRepository.findOne({
        order: { createdAt: 'DESC' },
      });
    }

    if (!snapshot) {
      throw new Error('No airdrop snapshot found');
    }

    // Find the leaf for this FID
    const leafData = snapshot.treeData.leaves.find((l) => l.fid === fid);
    if (!leafData) {
      console.log(`❌ [MERKLE PROOF] FID ${fid} not found in snapshot`);
      return null;
    }

    // Rebuild the merkle tree from stored leaves
    const leafHashes = snapshot.treeData.leaves.map((l) =>
      Buffer.from(l.leaf.slice(2), 'hex'),
    );
    const tree = new MerkleTree(leafHashes, keccak256, {
      sortPairs: true,
    });

    // Get the proof
    const leafHash = Buffer.from(leafData.leaf.slice(2), 'hex');
    const proof = tree.getProof(leafHash).map((p) => '0x' + p.data.toString('hex'));

    console.log(
      `✅ [MERKLE PROOF] Generated proof for FID ${fid}, amount: ${leafData.amount}`,
    );

    return {
      fid,
      amount: leafData.amount,
      proof,
      merkleRoot: snapshot.merkleRoot,
      snapshotId: snapshot.id,
    };
  }
}
