import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AirdropScore, User } from '../../../models';
import { getConfig } from '../../../security/config';

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
    let existingAirdropScore = await this.airdropScoreRepository.findOne({
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

    const percentage = 5;
    const tokenAllocation = Math.round(
      (percentage / 100) * this.TOTAL_ALLOCATION,
    );

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
      followingBrndTwitter: boolean;
      followingFlocTwitter: boolean;
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

      // TODO: Implement Twitter follow checks
      const followingBrndTwitter = false;
      const followingFlocTwitter = false;

      const details = {
        followingBrnd,
        followingFloc,
        followingBrndTwitter,
        followingFlocTwitter,
      };

      const followedCount = [
        followingBrnd,
        followingFloc,
        followingBrndTwitter,
        followingFlocTwitter,
      ].filter(Boolean).length;

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
          followingBrndTwitter: false,
          followingFlocTwitter: false,
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
  }> {
    try {
      console.log(`💰 [BRND HOLDINGS] Checking token holdings for FID: ${fid}`);

      // Get user's verified addresses from Neynar
      const userInfo = await this.getNeynarUserInfo(fid);
      if (!userInfo?.verified_addresses?.eth_addresses) {
        console.log(
          `❌ [BRND HOLDINGS] No verified ETH addresses found for FID: ${fid}`,
        );
        return { multiplier: 1.0, totalBalance: 0 };
      }

      const ethAddresses = userInfo.verified_addresses.eth_addresses;
      console.log(
        `🔍 [BRND HOLDINGS] Found ${ethAddresses.length} verified ETH addresses:`,
        ethAddresses,
      );

      // Check BRND balance for each address
      const balancePromises = ethAddresses.map((address) =>
        this.getBrndBalance(address),
      );
      const balances = await Promise.all(balancePromises);

      // Sum all balances
      const totalBalance = balances.reduce((sum, balance) => sum + balance, 0);
      console.log(
        `💰 [BRND HOLDINGS] Total BRND balance: ${totalBalance.toLocaleString()}`,
      );

      // Apply multiplier based on holdings according to spec
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
        multiplier,
        tier,
        logic: `Holding ${totalBalance.toLocaleString()} BRND tokens`,
      });

      return { multiplier, totalBalance };
    } catch (error) {
      console.error('Error calculating holdings multiplier:', error);
      return { multiplier: 1.0, totalBalance: 0 };
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
      const hasBrndTokenInProfile =
        profileBio.toLowerCase().includes('$brnd') ||
        profileBio.toLowerCase().includes('brnd token') ||
        profileBio.toLowerCase().includes('brnd');

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
        name: 'Seguir Cuentas',
        description:
          'Seguir a @brnd + @floc (y cuentas de Twitter @wearefloc @brnd_land)',
        currentValue: followAccountsResult.followedCount,
        currentMultiplier: followAccountsResult.multiplier,
        maxMultiplier: 1.4,
        completed: followAccountsResult.followedCount >= 2,
        progress: {
          current: followAccountsResult.followedCount,
          required: 2,
          unit: 'cuentas',
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
      },

      // Channel Interaction Challenge
      {
        name: 'Interacción con Canal /brnd',
        description: 'Seguir canal + Publicar podium',
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
      },

      // BRND Holdings Challenge
      {
        name: 'Holding $BRND',
        description: 'Mantener tokens $BRND',
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
      },

      // Collectibles Challenge
      {
        name: 'Coleccionar Collectibles Cast de BRND',
        description: 'Coleccionar casts de BRND',
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
        name: 'Haber Votado Marcas Distintas',
        description: 'Votar marcas distintas',
        currentValue: votedBrandsResult.votedBrandsCount,
        currentMultiplier: votedBrandsResult.multiplier,
        maxMultiplier: 1.8,
        completed: votedBrandsResult.votedBrandsCount >= 72,
        progress: {
          current: votedBrandsResult.votedBrandsCount,
          required: 72,
          unit: 'marcas',
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
      },

      // Shared Podiums Challenge
      {
        name: 'Haber Compartido Podiums',
        description: 'Compartir podiums',
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
      },

      // Pro User Challenge
      {
        name: 'Ser Pro User + Token $BRND en Perfil',
        description: 'Ser Pro User + Token $BRND en perfil',
        currentValue: proUserResult.isProUser
          ? proUserResult.hasBrndTokenInProfile
            ? 2
            : 1
          : 0,
        currentMultiplier: proUserResult.multiplier,
        maxMultiplier: 1.4,
        completed:
          proUserResult.isProUser && proUserResult.hasBrndTokenInProfile,
        progress: {
          current: proUserResult.isProUser
            ? proUserResult.hasBrndTokenInProfile
              ? 2
              : 1
            : 0,
          required: 2,
          unit: 'estado',
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
            achieved:
              proUserResult.isProUser && proUserResult.hasBrndTokenInProfile,
          },
        ],
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
}
