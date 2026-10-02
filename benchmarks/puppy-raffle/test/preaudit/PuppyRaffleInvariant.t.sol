// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import {Test} from "forge-std/Test.sol";
import {PuppyRaffle} from "../../src/PuppyRaffle.sol";

/// Drives the raffle the way honest users would: enter, refund, draw. The fuzzer picks the order.
contract RaffleHandler is Test {
    PuppyRaffle private immutable raffle;
    uint256 private immutable fee;
    address[] private entered;

    constructor(PuppyRaffle _raffle) {
        raffle = _raffle;
        fee = _raffle.entranceFee();
    }

    function enter(uint256 seed, uint8 count) external {
        uint256 n = bound(uint256(count), 1, 5);
        address[] memory players = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            players[i] = address(uint160(uint256(keccak256(abi.encode(seed, i, entered.length)))));
        }
        vm.deal(address(this), address(this).balance + fee * n);
        raffle.enterRaffle{value: fee * n}(players);
        for (uint256 i = 0; i < n; i++) entered.push(players[i]);
    }

    function refund(uint256 which) external {
        if (entered.length == 0) return;
        address player = entered[which % entered.length];
        uint256 index = raffle.getActivePlayerIndex(player);
        vm.prank(player);
        raffle.refund(index);
    }

    function draw() external {
        vm.warp(block.timestamp + raffle.raffleDuration() + 1);
        raffle.selectWinner();
    }
}

/// Stateful invariant for the forge fuzz stage: whatever sequence of entries, refunds and
/// draws happens, the rule below must hold after every call.
contract PuppyRaffleInvariant is Test {
    PuppyRaffle private raffle;
    RaffleHandler private handler;

    function setUp() public {
        raffle = new PuppyRaffle(1e18, address(0xFEE), 1 days);
        handler = new RaffleHandler(raffle);
        targetContract(address(handler));
    }

    /// The fees the protocol has recorded must always be in the contract, ready to withdraw.
    function invariant_recordedFeesAreBackedByBalance() public {
        assertGe(address(raffle).balance, uint256(raffle.totalFees()), "recorded fees exceed the ETH the raffle holds");
    }
}
