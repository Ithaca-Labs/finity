// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Finity Mandate Registry
/// @notice Stores Ledger-signed authority and enforces broker budget reservations.
contract MandateRegistry {
    string public constant DOMAIN_NAME = "FinityMandate";
    string public constant DOMAIN_VERSION = "1";
    uint256 public constant RESERVATION_TTL = 10 minutes;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant AGENT_MANDATE_TYPEHASH = keccak256(
        "AgentMandate(string agent,address broker,string spendAccount,string allowedServices,string allowedMethods,string asset,uint256 maxPerRequest,string maxPerRequestText,uint256 maxPerPeriod,string maxPerPeriodText,uint256 periodSeconds,uint256 maxLifetime,string maxLifetimeText,uint256 maxUnitsPerRequest,uint256 validFrom,uint256 validUntil,string validUntilText,uint256 quoteMaxAgeSeconds,uint8 dataClass,string escalationRule,bytes32 policyHash,uint256 nonce,bytes32 predecessor)"
    );
    bytes32 private constant REVOCATION_TYPEHASH = keccak256(
        "Revocation(bytes32 mandateId,uint256 nonce,string reason)"
    );
    bytes32 private constant AMENDMENT_TYPEHASH = keccak256(
        "MandateAmendment(bytes32 mandateId,uint256 field,uint256 newValue,string newValueText,string scopeServiceId,bool oneTime,uint256 validUntil,uint256 nonce)"
    );

    /// Field 0 is the v1 maxPerRequest amendment defined by the broker policy.
    uint256 public constant MAX_PER_REQUEST_FIELD = 0;

    enum Status {
        NONE,
        ACTIVE,
        EXHAUSTED,
        EXPIRED,
        REVOKED,
        SUPERSEDED
    }

    struct AgentMandate {
        string agent;
        address broker;
        string spendAccount;
        string allowedServices;
        string allowedMethods;
        string asset;
        uint256 maxPerRequest;
        string maxPerRequestText;
        uint256 maxPerPeriod;
        string maxPerPeriodText;
        uint256 periodSeconds;
        uint256 maxLifetime;
        string maxLifetimeText;
        uint256 maxUnitsPerRequest;
        uint256 validFrom;
        uint256 validUntil;
        string validUntilText;
        uint256 quoteMaxAgeSeconds;
        uint8 dataClass;
        string escalationRule;
        bytes32 policyHash;
        uint256 nonce;
        bytes32 predecessor;
    }

    struct Limits {
        uint256 maxPerRequest;
        uint256 maxPerPeriod;
        uint256 periodSeconds;
        uint256 maxLifetime;
        uint256 validFrom;
        uint256 validUntil;
    }

    struct Record {
        address principal;
        address broker;
        bytes32 policyHash;
        Limits limits;
        uint256 lifetimeConsumed;
        uint256 periodIndex;
        uint256 periodConsumed;
        uint256 reserved;
        Status status;
        bytes32 successor;
        string traceTopic;
    }

    struct Revocation {
        bytes32 mandateId;
        uint256 nonce;
        string reason;
    }

    struct MandateAmendment {
        bytes32 mandateId;
        uint256 field;
        uint256 newValue;
        string newValueText;
        string scopeServiceId;
        bool oneTime;
        uint256 validUntil;
        uint256 nonce;
    }

    struct Reservation {
        bytes32 mandateId;
        uint256 amount;
        uint256 createdAt;
        bool active;
    }

    mapping(bytes32 => Record) private _records;
    mapping(bytes32 => Reservation) private _reservations;
    mapping(address => mapping(uint256 => bool)) public usedNonces;
    mapping(bytes32 => bool) public oneTimeMandates;
    uint256 private _reservationNonce;

    error InvalidSignature();
    error InvalidMandate();
    error MandateAlreadyRegistered();
    error MandateNotFound();
    error MandateNotActive();
    error UnauthorizedBroker();
    error UnauthorizedPrincipal();
    error NonceAlreadyUsed();
    error LimitExceeded();
    error InvalidAmount();
    error ReservationNotFound();
    error ReservationExpired();
    error ReservationStillLive();
    error TraceTopicAlreadySet();
    error InvalidAmendment();

    event MandateRegistered(bytes32 indexed mandateId, address indexed principal, address indexed broker);
    event ReservationCreated(bytes32 indexed reservationId, bytes32 indexed mandateId, uint256 amount);
    event ReservationFinalized(bytes32 indexed reservationId, bytes32 indexed mandateId, uint256 reserved, uint256 actual);
    event ReservationReleased(bytes32 indexed reservationId, bytes32 indexed mandateId, uint256 amount);
    event MandateRevoked(bytes32 indexed mandateId, string reason);
    event MandateAmended(bytes32 indexed mandateId, bytes32 indexed successor, uint256 field, uint256 newValue, bool oneTime);
    event TraceTopicSet(bytes32 indexed mandateId, string traceTopic);

    function registerMandate(AgentMandate calldata mandate, bytes calldata signature)
        external
        returns (bytes32 mandateId)
    {
        if (
            mandate.broker == address(0) ||
            mandate.validFrom >= mandate.validUntil ||
            mandate.periodSeconds == 0 ||
            mandate.maxPerRequest == 0 ||
            mandate.maxPerPeriod == 0 ||
            mandate.maxLifetime == 0
        ) revert InvalidMandate();

        bytes32 digest = _hashTypedData(_hashAgentMandate(mandate));
        address principal = _recover(digest, signature);
        if (principal == address(0)) revert InvalidSignature();
        if (usedNonces[principal][mandate.nonce]) revert NonceAlreadyUsed();
        if (_records[digest].principal != address(0)) revert MandateAlreadyRegistered();

        usedNonces[principal][mandate.nonce] = true;
        mandateId = digest;
        _records[mandateId] = Record({
            principal: principal,
            broker: mandate.broker,
            policyHash: mandate.policyHash,
            limits: Limits({
                maxPerRequest: mandate.maxPerRequest,
                maxPerPeriod: mandate.maxPerPeriod,
                periodSeconds: mandate.periodSeconds,
                maxLifetime: mandate.maxLifetime,
                validFrom: mandate.validFrom,
                validUntil: mandate.validUntil
            }),
            lifetimeConsumed: 0,
            periodIndex: block.timestamp / mandate.periodSeconds,
            periodConsumed: 0,
            reserved: 0,
            status: Status.ACTIVE,
            successor: bytes32(0),
            traceTopic: ""
        });

        emit MandateRegistered(mandateId, principal, mandate.broker);
    }

    function reserve(bytes32 mandateId, uint256 amount) external returns (bytes32 reservationId) {
        Record storage mandate = _records[mandateId];
        if (mandate.principal == address(0)) revert MandateNotFound();
        if (msg.sender != mandate.broker) revert UnauthorizedBroker();
        _requireActive(mandate);
        if (amount == 0) revert InvalidAmount();

        _syncPeriod(mandate);
        if (amount > mandate.limits.maxPerRequest) revert LimitExceeded();
        if (mandate.periodConsumed + mandate.reserved + amount > mandate.limits.maxPerPeriod) revert LimitExceeded();
        if (mandate.lifetimeConsumed + mandate.reserved + amount > mandate.limits.maxLifetime) revert LimitExceeded();
        if (oneTimeMandates[mandateId] && mandate.lifetimeConsumed + mandate.reserved != 0) revert LimitExceeded();

        mandate.reserved += amount;
        reservationId = keccak256(abi.encode(mandateId, msg.sender, amount, _reservationNonce++));
        _reservations[reservationId] = Reservation({
            mandateId: mandateId,
            amount: amount,
            createdAt: block.timestamp,
            active: true
        });
        emit ReservationCreated(reservationId, mandateId, amount);
    }

    function finalize(bytes32 reservationId, uint256 actual) external {
        Reservation storage reservationState = _reservations[reservationId];
        if (!reservationState.active) revert ReservationNotFound();
        Record storage mandate = _records[reservationState.mandateId];
        if (msg.sender != mandate.broker) revert UnauthorizedBroker();
        if (block.timestamp > reservationState.createdAt + RESERVATION_TTL) revert ReservationExpired();
        if (actual > reservationState.amount) revert InvalidAmount();

        _syncPeriod(mandate);
        uint256 reservedAmount = reservationState.amount;
        reservationState.active = false;
        mandate.reserved -= reservedAmount;
        mandate.periodConsumed += actual;
        mandate.lifetimeConsumed += actual;
        if (mandate.lifetimeConsumed >= mandate.limits.maxLifetime || oneTimeMandates[reservationState.mandateId]) {
            mandate.status = Status.EXHAUSTED;
        }
        emit ReservationFinalized(reservationId, reservationState.mandateId, reservedAmount, actual);
    }

    function release(bytes32 reservationId) external {
        Reservation storage reservationState = _reservations[reservationId];
        if (!reservationState.active) revert ReservationNotFound();
        Record storage mandate = _records[reservationState.mandateId];
        if (msg.sender != mandate.broker && block.timestamp <= reservationState.createdAt + RESERVATION_TTL) {
            revert ReservationStillLive();
        }

        reservationState.active = false;
        mandate.reserved -= reservationState.amount;
        emit ReservationReleased(reservationId, reservationState.mandateId, reservationState.amount);
    }

    function revoke(Revocation calldata revocation, bytes calldata signature) external {
        Record storage mandate = _records[revocation.mandateId];
        if (mandate.principal == address(0)) revert MandateNotFound();
        if (usedNonces[mandate.principal][revocation.nonce]) revert NonceAlreadyUsed();
        address signer = _recover(_hashTypedData(_hashRevocation(revocation)), signature);
        if (signer != mandate.principal) revert UnauthorizedPrincipal();

        usedNonces[signer][revocation.nonce] = true;
        mandate.status = Status.REVOKED;
        emit MandateRevoked(revocation.mandateId, revocation.reason);
    }

    function amend(MandateAmendment calldata amendment, bytes calldata signature)
        external
        returns (bytes32 successorId)
    {
        Record storage predecessor = _records[amendment.mandateId];
        if (predecessor.principal == address(0)) revert MandateNotFound();
        if (predecessor.status != Status.ACTIVE || predecessor.reserved != 0) revert InvalidAmendment();
        if (amendment.field != MAX_PER_REQUEST_FIELD || amendment.newValue == 0) revert InvalidAmendment();
        if (amendment.validUntil <= predecessor.limits.validFrom || amendment.validUntil > predecessor.limits.validUntil) {
            revert InvalidAmendment();
        }
        if (usedNonces[predecessor.principal][amendment.nonce]) revert NonceAlreadyUsed();

        bytes32 amendmentDigest = _hashTypedData(_hashAmendment(amendment));
        address signer = _recover(amendmentDigest, signature);
        if (signer != predecessor.principal) revert UnauthorizedPrincipal();
        usedNonces[signer][amendment.nonce] = true;

        successorId = keccak256(abi.encode(amendment.mandateId, amendmentDigest));
        if (_records[successorId].principal != address(0)) revert MandateAlreadyRegistered();

        _syncPeriod(predecessor);
        Limits memory successorLimits = predecessor.limits;
        successorLimits.maxPerRequest = amendment.newValue;
        successorLimits.validUntil = amendment.validUntil;
        _records[successorId] = Record({
            principal: predecessor.principal,
            broker: predecessor.broker,
            policyHash: predecessor.policyHash,
            limits: successorLimits,
            lifetimeConsumed: predecessor.lifetimeConsumed,
            periodIndex: predecessor.periodIndex,
            periodConsumed: predecessor.periodConsumed,
            reserved: 0,
            status: Status.ACTIVE,
            successor: bytes32(0),
            traceTopic: predecessor.traceTopic
        });
        oneTimeMandates[successorId] = amendment.oneTime;
        predecessor.status = Status.SUPERSEDED;
        predecessor.successor = successorId;

        emit MandateAmended(amendment.mandateId, successorId, amendment.field, amendment.newValue, amendment.oneTime);
    }

    function setTraceTopic(bytes32 mandateId, string calldata traceTopic) external {
        Record storage mandate = _records[mandateId];
        if (mandate.principal == address(0)) revert MandateNotFound();
        if (msg.sender != mandate.broker) revert UnauthorizedBroker();
        if (bytes(mandate.traceTopic).length != 0) revert TraceTopicAlreadySet();
        if (bytes(traceTopic).length == 0) revert InvalidMandate();
        mandate.traceTopic = traceTopic;
        emit TraceTopicSet(mandateId, traceTopic);
    }

    function status(bytes32 mandateId) public view returns (Status) {
        Record storage mandate = _records[mandateId];
        if (mandate.principal == address(0)) return Status.NONE;
        return _effectiveStatus(mandate);
    }

    function record(bytes32 mandateId) external view returns (Record memory result) {
        Record storage stored = _records[mandateId];
        if (stored.principal == address(0)) revert MandateNotFound();
        result = stored;
        result.status = _effectiveStatus(stored);
    }

    function reservation(bytes32 reservationId) external view returns (Reservation memory) {
        return _reservations[reservationId];
    }

    function hashAgentMandate(AgentMandate calldata mandate) external pure returns (bytes32) {
        return _hashAgentMandate(mandate);
    }

    function hashTypedData(bytes32 structHash) external view returns (bytes32) {
        return _hashTypedData(structHash);
    }

    function _hashAgentMandate(AgentMandate calldata mandate) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                AGENT_MANDATE_TYPEHASH,
                keccak256(bytes(mandate.agent)),
                mandate.broker,
                keccak256(bytes(mandate.spendAccount)),
                keccak256(bytes(mandate.allowedServices)),
                keccak256(bytes(mandate.allowedMethods)),
                keccak256(bytes(mandate.asset)),
                mandate.maxPerRequest,
                keccak256(bytes(mandate.maxPerRequestText)),
                mandate.maxPerPeriod,
                keccak256(bytes(mandate.maxPerPeriodText)),
                mandate.periodSeconds,
                mandate.maxLifetime,
                keccak256(bytes(mandate.maxLifetimeText)),
                mandate.maxUnitsPerRequest,
                mandate.validFrom,
                mandate.validUntil,
                keccak256(bytes(mandate.validUntilText)),
                mandate.quoteMaxAgeSeconds,
                mandate.dataClass,
                keccak256(bytes(mandate.escalationRule)),
                mandate.policyHash,
                mandate.nonce,
                mandate.predecessor
            )
        );
    }

    function _hashRevocation(Revocation calldata revocation) private pure returns (bytes32) {
        return keccak256(
            abi.encode(REVOCATION_TYPEHASH, revocation.mandateId, revocation.nonce, keccak256(bytes(revocation.reason)))
        );
    }

    function _hashAmendment(MandateAmendment calldata amendment) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                AMENDMENT_TYPEHASH,
                amendment.mandateId,
                amendment.field,
                amendment.newValue,
                keccak256(bytes(amendment.newValueText)),
                keccak256(bytes(amendment.scopeServiceId)),
                amendment.oneTime,
                amendment.validUntil,
                amendment.nonce
            )
        );
    }

    function _hashTypedData(bytes32 structHash) private view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256(bytes(DOMAIN_NAME)), keccak256(bytes(DOMAIN_VERSION)), block.chainid, address(this))
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert InvalidSignature();
        }
        signer = ecrecover(digest, v, r, s);
    }

    function _effectiveStatus(Record storage mandate) private view returns (Status) {
        if (mandate.status == Status.ACTIVE && block.timestamp >= mandate.limits.validUntil) return Status.EXPIRED;
        return mandate.status;
    }

    function _requireActive(Record storage mandate) private view {
        if (_effectiveStatus(mandate) != Status.ACTIVE) revert MandateNotActive();
        if (block.timestamp < mandate.limits.validFrom) revert MandateNotActive();
    }

    function _syncPeriod(Record storage mandate) private {
        uint256 currentPeriod = block.timestamp / mandate.limits.periodSeconds;
        if (currentPeriod != mandate.periodIndex) {
            mandate.periodIndex = currentPeriod;
            mandate.periodConsumed = 0;
        }
    }
}
