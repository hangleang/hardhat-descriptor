// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Vault
/// @notice Holds ETH on behalf of depositors. Each address can deposit and
///         later withdraw its own balance. Withdrawal allowances can be
///         granted via an EIP-712 signed `WithdrawalPermit`.
contract Vault {
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public nonces;

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, address indexed to, uint256 amount);

    // --- EIP-712 typed data --------------------------------------------------

    string public constant name = "Vault";
    string public constant version = "1";

    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @dev EIP-712 typehash for the off-chain withdrawal permit.
    ///      struct WithdrawalPermit { address owner; address to; uint256 amount; uint256 nonce; uint256 deadline; }
    bytes32 public constant WITHDRAWAL_PERMIT_TYPEHASH =
        keccak256(
            "WithdrawalPermit(address owner,address to,uint256 amount,uint256 nonce,uint256 deadline)"
        );

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    DOMAIN_TYPEHASH,
                    keccak256(bytes(name)),
                    keccak256(bytes(version)),
                    block.chainid,
                    address(this)
                )
            );
    }

    /// @notice Deposit ETH and credit the sender.
    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Withdraw `amount` wei from the sender's balance to `to`.
    /// @param to Recipient of the withdrawn ETH.
    /// @param amount Amount of wei to withdraw.
    function withdraw(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        _payout(msg.sender, to, amount);
    }

    /// @notice Withdraw on behalf of `owner` using an EIP-712 signed permit.
    /// @param owner    Account whose balance is debited.
    /// @param to       Recipient of the withdrawn ETH.
    /// @param amount   Amount of wei to withdraw.
    /// @param deadline Latest block timestamp at which the permit is still valid.
    /// @param v        Signature recovery id.
    /// @param r        Signature r value.
    /// @param s        Signature s value.
    function withdrawWithPermit(
        address owner,
        address to,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp <= deadline, "permit expired");
        require(balanceOf[owner] >= amount, "insufficient");

        bytes32 structHash = keccak256(
            abi.encode(
                WITHDRAWAL_PERMIT_TYPEHASH,
                owner,
                to,
                amount,
                nonces[owner]++,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == owner, "bad signature");

        _payout(owner, to, amount);
    }

    function _payout(address from, address to, uint256 amount) private {
        balanceOf[from] -= amount;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "transfer failed");
        emit Withdrawn(from, to, amount);
    }
}
