// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {BaseBasketRouter} from "../BaseBasketRouter.sol";

contract DeployBaseBasket is Script {
    // Base Mainnet (Chain ID 8453) Core Protocol Targets
    address constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address constant AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant AERODROME_SLIPSTREAM_ROUTER = 0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5;
    address constant ZERO_X_ALLOWANCE_HOLDER = 0x0000000000001fF3684f28c67538d4D072C22734;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address feeCollector = vm.envAddress("FEE_COLLECTOR_ADDRESS");
        address guardian = vm.envAddress("GUARDIAN_ADDRESS");
        address initialOwner = vm.envAddress("OWNER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        BaseBasketRouter router = new BaseBasketRouter(
            feeCollector,
            guardian,
            initialOwner
        );

        address[] memory targets = new address[](4);
        targets[0] = MORPHO_BLUE;
        targets[1] = AERODROME_ROUTER;
        targets[2] = AERODROME_SLIPSTREAM_ROUTER;
        targets[3] = ZERO_X_ALLOWANCE_HOLDER;

        router.setAllowedTargetsBatch(targets, true);

        vm.stopBroadcast();

        console2.log("BaseBasketRouter deployed at:", address(router));
        console2.log("Whitelisted Morpho Blue, Aerodrome Router, Slipstream Router, and 0x AllowanceHolder.");
        console2.log("IMPORTANT: Also whitelist the 0x Settler target address returned by /api/quote before live user swaps!");
Use code with caution.
}
}
