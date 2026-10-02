// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import {Test} from "forge-std/Test.sol";
import {PuppyRaffle} from "../../src/PuppyRaffle.sol";

/// Symbolic properties for Halmos (functions prefixed `check_`).
/// Layered onto the project with `--harness benchmarks/puppy-raffle`; run by the halmos stage.
contract PuppyRaffleSymbolic is Test {
    /// After a draw, the protocol must record exactly 20% of what four players paid in.
    /// Halmos tries every entrance fee at once instead of sampling a few.
    function check_feesRecordedMatchFeesCollected(uint256 entranceFee) public {
        vm.assume(entranceFee > 0 && entranceFee < 2 ** 96);
        PuppyRaffle raffle = new PuppyRaffle(entranceFee, address(0xFEE), 1 days);

        address[] memory players = new address[](4);
        players[0] = address(0x1001);
        players[1] = address(0x1002);
        players[2] = address(0x1003);
        players[3] = address(0x1004);
        vm.deal(address(this), entranceFee * 4);
        raffle.enterRaffle{value: entranceFee * 4}(players);

        vm.warp(block.timestamp + 1 days + 1);
        raffle.selectWinner();

        uint256 expectedFee = (entranceFee * 4 * 20) / 100;
        _assert(uint256(raffle.totalFees()) == expectedFee);
    }

    /// Before Solidity 0.8, `assert` compiles to the INVALID opcode, which Halmos does not count as
    /// an assertion failure, so a violated property would silently PASS. Revert with Panic(1) instead,
    /// exactly what `assert` does from 0.8 on.
    function _assert(bool ok) internal pure {
        if (!ok) {
            assembly {
                mstore(0x00, 0x4e487b7100000000000000000000000000000000000000000000000000000000)
                mstore(0x04, 0x01)
                revert(0x00, 0x24)
            }
        }
    }
}
