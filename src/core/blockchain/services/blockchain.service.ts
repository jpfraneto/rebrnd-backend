import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../../../models';
import { getConfig } from '../../../security/config';
import { logger } from '../../../main';

@Injectable()
export class BlockchainService {
  private readonly BRND_TOKEN = '0x41Ed0311640A5e489A90940b1c33433501a21B07';
  private readonly TELLER_VAULT = '0x19d1872d8328b23a219e11d3d6eeee1954a88f88';

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async getUserStakeInfo(fid: number): Promise<{
    walletBalance: number;
    vaultShares: number;
    stakedAmount: number;
    totalBalance: number;
    addresses: string[];
  }> {
    try {
      logger.log(`💰 [BLOCKCHAIN] Getting stake info for FID: ${fid}`);

      const userInfo = await this.getNeynarUserInfo(fid);
      if (!userInfo?.verified_addresses?.eth_addresses) {
        logger.log(
          `❌ [BLOCKCHAIN] No verified ETH addresses found for FID: ${fid}`,
        );
        return {
          walletBalance: 0,
          vaultShares: 0,
          stakedAmount: 0,
          totalBalance: 0,
          addresses: [],
        };
      }

      const ethAddresses = userInfo.verified_addresses.eth_addresses;
      logger.log(
        `🔍 [BLOCKCHAIN] Found ${ethAddresses.length} verified ETH addresses`,
      );

      const balancePromises = ethAddresses.map(async (address) => {
        const [walletBalance, stakedBalance] = await Promise.all([
          this.getBrndBalance(address),
          this.getStakedBrndBalance(address),
        ]);
        return { walletBalance, stakedBalance };
      });

      const addressBalances = await Promise.all(balancePromises);

      const totalWalletBalance = addressBalances.reduce(
        (sum, balance) => sum + balance.walletBalance,
        0,
      );
      const totalStakedBalance = addressBalances.reduce(
        (sum, balance) => sum + balance.stakedBalance,
        0,
      );

      return {
        walletBalance: totalWalletBalance,
        vaultShares: 0, // TODO: Calculate actual vault shares
        stakedAmount: totalStakedBalance,
        totalBalance: totalWalletBalance + totalStakedBalance,
        addresses: ethAddresses,
      };
    } catch (error) {
      logger.error('Error getting user stake info:', error);
      throw error;
    }
  }

  private async getNeynarUserInfo(fid: number): Promise<any> {
    try {
      logger.log(`🔍 [NEYNAR] Fetching user info for FID: ${fid}`);
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
      return data?.users?.[0] || null;
    } catch (error) {
      logger.error('Error fetching Neynar user info:', error);
      return null;
    }
  }

  private async getBrndBalance(address: string): Promise<number> {
    try {
      logger.log(`🔍 [BLOCKCHAIN] Checking BRND balance for: ${address}`);

      const config = getConfig();
      const BASE_RPC_URL = config.blockchain.baseRpcUrl;

      const functionSelector = '0x70a08231'; // balanceOf(address)
      const paddedAddress = address.slice(2).padStart(64, '0');
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
              to: this.BRND_TOKEN,
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

      const balanceHex = result.result;
      const balanceWei = BigInt(balanceHex);
      const balance = Number(balanceWei) / Math.pow(10, 18);

      logger.log(`💰 [BLOCKCHAIN] BRND balance: ${balance.toLocaleString()}`);
      return balance;
    } catch (error) {
      logger.error(`Error getting BRND balance for ${address}:`, error);
      return 0;
    }
  }

  private async getStakedBrndBalance(address: string): Promise<number> {
    try {
      logger.log(`🥩 [BLOCKCHAIN] Checking staked BRND for: ${address}`);

      const config = getConfig();
      const BASE_RPC_URL = config.blockchain.baseRpcUrl;

      // Step 1: Get vault shares
      const functionSelector = '0x70a08231'; // balanceOf(address)
      const paddedAddress = address.slice(2).padStart(64, '0');
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
              to: this.TELLER_VAULT,
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

      if (sharesBigInt === 0n) {
        logger.log(`🥩 [BLOCKCHAIN] No vault shares for: ${address}`);
        return 0;
      }

      // Step 2: Convert shares to assets
      const convertToAssetsSelector = '0x07a2d13a'; // convertToAssets(uint256)
      const paddedShares = sharesHex.slice(2).padStart(64, '0');
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
              to: this.TELLER_VAULT,
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

      const assetsHex = assetsResult.result;
      const assetsBigInt = BigInt(assetsHex);
      const stakedBalance = Number(assetsBigInt) / Math.pow(10, 18);

      logger.log(
        `🥩 [BLOCKCHAIN] Staked balance: ${stakedBalance.toLocaleString()}`,
      );
      return stakedBalance;
    } catch (error) {
      logger.error(`Error getting staked BRND balance for ${address}:`, error);
      return 0;
    }
  }

  async checkFollowStatus(fid: number): Promise<{
    followingBrnd: boolean;
    followingFloc: boolean;
  }> {
    try {
      logger.log(`🔍 [BLOCKCHAIN] Checking follow status for FID: ${fid}`);
      const apiKey = getConfig().neynar.apiKey.replace(/&$/, '');
      const BRND_FID = 1108951;
      const FLOC_FID = 6946;

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
      const users = data?.users || [];
      const brndUser = users.find((u) => u.fid === BRND_FID);
      const flocUser = users.find((u) => u.fid === FLOC_FID);

      const followingBrnd = brndUser?.viewer_context?.following || false;
      const followingFloc = flocUser?.viewer_context?.following || false;

      logger.log(`📱 [BLOCKCHAIN] Follow status:`, {
        followingBrnd,
        followingFloc,
      });

      return { followingBrnd, followingFloc };
    } catch (error) {
      logger.error('Error checking follow status:', error);
      return { followingBrnd: false, followingFloc: false };
    }
  }
}