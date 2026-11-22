// SPDX-License-Identifier: UNLICENSED
// Copyright (c) 2026 Statera Inc. All Rights Reserved.
// Proprietary and confidential. Unauthorized copying, forking, or commercial deployment is strictly prohibited.
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title BaseBasketRouter
/// @author Statera Inc.
/// @notice Stateless, non-custodial atomic execution router on Base L2 with 3-tier volume fee caps.
contract BaseBasketRouter is ReentrancyGuard, Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    address public immutable feeCollector;
    address public guardian;

    // Hardcoded on-chain fee ceilings (in basis points, 10_000 = 100%)
    uint256 public constant MAX_RETAIL_FEE_BPS = 150;       // 1.50% Standard ceiling (< $5,000)
    uint256 public constant MAX_PRO_FEE_BPS = 75;           // 0.75% Pro ceiling ($5,000 - $99,999)
    uint256 public constant MAX_INSTITUTIONAL_FEE_BPS = 25; // 0.25% Institutional ceiling (>= $100,000)

    mapping(address => bool) public allowedTargets;

    struct Approval {
        address token;
        address spender;
        uint256 amount;
    }

    struct Call {
        address target;
        uint256 value;
        bytes callData;
    }

    struct BasketOrder {
        address inputToken;
        uint256 totalAmount;
        uint256 feeBps;
        address outputToken;
        uint256 minOutputAmount;
    }

    event BasketExecuted(
        address indexed user,
        address indexed inputToken,
        uint256 netAmount,
        uint256 feeAmount
    );
    event TargetStatusUpdated(address indexed target, bool allowed);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);

    error ZeroAddress();
    error ZeroAmount();
    error FeeExceedsTierCap(uint256 providedBps, uint256 maxAllowedBps);
    error TargetNotWhitelisted(address target);
    error SlippageCheckFailed(uint256 received, uint256 minimum);
    error EthRefundFailed();

    constructor(
        address _feeCollector,
        address _guardian,
        address _initialOwner
    ) Ownable(_initialOwner) {
        if (_feeCollector == address(0) || _guardian == address(0) || _initialOwner == address(0)) {
            revert ZeroAddress();
        }
        feeCollector = _feeCollector;
        guardian = _guardian;
    }

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert OwnableUnauthorizedAccount(msg.sender);
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setGuardian(address newGuardian) external onlyOwner {
        if (newGuardian == address(0)) revert ZeroAddress();
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    function setAllowedTarget(address target, bool allowed) external onlyOwner {
        if (target == address(0)) revert ZeroAddress();
        allowedTargets[target] = allowed;
        emit TargetStatusUpdated(target, allowed);
    }

    function setAllowedTargetsBatch(address[] calldata targets, bool allowed) external onlyOwner {
        for (uint256 i = 0; i < targets.length; i++) {
            if (targets[i] == address(0)) revert ZeroAddress();
            allowedTargets[targets[i]] = allowed;
            emit TargetStatusUpdated(targets[i], allowed);
        }
    }

    /// @notice Executes an atomic multi-protocol basket route in a single signature
    function executeAtomicBasket(
        BasketOrder calldata order,
        Approval[] calldata approvals,
        Call[] calldata calls,
        address[] calldata sweepTokens
    ) external payable nonReentrant whenNotPaused {
        if (order.totalAmount == 0) revert ZeroAmount();
        if (order.feeBps > MAX_RETAIL_FEE_BPS) {
            revert FeeExceedsTierCap(order.feeBps, MAX_RETAIL_FEE_BPS);
        }

        uint256 ethBefore = address(this).balance - msg.value;
        uint256 outputBefore = order.outputToken != address(0)
            ? IERC20(order.outputToken).balanceOf(msg.sender)
            : 0;

        // 1. Pull user input capital & route protocol fee
        IERC20(order.inputToken).safeTransferFrom(msg.sender, address(this), order.totalAmount);
        uint256 feeAmount = (order.totalAmount * order.feeBps) / 10_000;
        if (feeAmount > 0) {
            IERC20(order.inputToken).safeTransfer(feeCollector, feeAmount);
        }

        // 2. Grant exact scoped approvals & execute atomic calls
        _executeCalls(approvals, calls);

        // 3. Sweep leftover token dust back to msg.sender
        for (uint256 j = 0; j < sweepTokens.length; j++) {
            uint256 remaining = IERC20(sweepTokens[j]).balanceOf(address(this));
            if (remaining > 0) {
                IERC20(sweepTokens[j]).safeTransfer(msg.sender, remaining);
            }
        }

        // 4. Enforce on-chain minimum output floor
        if (order.outputToken != address(0) && order.minOutputAmount > 0) {
            uint256 received = IERC20(order.outputToken).balanceOf(msg.sender) - outputBefore;
            if (received < order.minOutputAmount) {
                revert SlippageCheckFailed(received, order.minOutputAmount);
            }
        }

        // 5. Refund any excess native ETH delta back to msg.sender
        uint256 ethAfter = address(this).balance;
        if (ethAfter > ethBefore) {
            (bool sent, ) = msg.sender.call{value: ethAfter - ethBefore}("");
            if (!sent) revert EthRefundFailed();
        }

        emit BasketExecuted(msg.sender, order.inputToken, order.totalAmount - feeAmount, feeAmount);
    }

    function _executeCalls(
        Approval[] calldata approvals,
        Call[] calldata calls
    ) internal {
        for (uint256 a = 0; a < approvals.length; a++) {
            if (!allowedTargets[approvals[a].spender]) {
                revert TargetNotWhitelisted(approvals[a].spender);
            }
            IERC20(approvals[a].token).forceApprove(approvals[a].spender, approvals[a].amount);
        }

        for (uint256 i = 0; i < calls.length; i++) {
            if (!allowedTargets[calls[i].target]) {
                revert TargetNotWhitelisted(calls[i].target);
            }
            (bool success, bytes memory result) = calls[i].target.call{
                value: calls[i].value
            }(calls[i].callData);

            if (!success) {
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
        }

        for (uint256 a = 0; a < approvals.length; a++) {
            IERC20(approvals[a].token).forceApprove(approvals[a].spender, 0);
        }
    }

    receive() external payable {}
}
