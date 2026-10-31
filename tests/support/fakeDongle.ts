// The tests' fake dongle is the app's simulated dongle (one implementation).
// It speaks the firmware's current protocol minor by default
// (PROTOCOL_MINOR_KNOWN); the tests written when the default was 1.6 pin
// { protoMinor: 6 } so they keep testing what they were written for.
export { SimulatedDongle as FakeDongle, type SimulatedDongleOptions as FakeDongleOptions } from "../../src/protocol/simulatedDongle";
