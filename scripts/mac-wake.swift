import Foundation
import IOKit.pwr_mgt

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let args = Array(CommandLine.arguments.dropFirst())
guard let scope = args.first, ["schedule", "test", "check"].contains(scope),
      args.count <= (scope == "test" ? 2 : 11) else { fail("Invalid wake request") }

if scope == "check" {
    guard args.count == 1 else { fail("Invalid wake request") }
    exit(0)
}

let owner = "org.athanbot." + scope
let wakeType = kIOPMAutoWake as CFString
let now = Date().timeIntervalSince1970
let requested = Set(args.dropFirst().map { value -> Date in
    guard let seconds = Int64(value), Double(seconds) > now,
          Double(seconds) < now + 4 * 86400 else { fail("Wake time is outside the allowed range") }
    return Date(timeIntervalSince1970: Double(seconds))
})

let scheduled = (IOPMCopyScheduledPowerEvents()?.takeRetainedValue() as? [[String: Any]]) ?? []
let existing = Set(scheduled.compactMap { event -> Date? in
    guard event[kIOPMPowerEventAppNameKey] as? String == owner,
          event[kIOPMPowerEventTypeKey] as? String == kIOPMAutoWake else { return nil }
    return event[kIOPMPowerEventTimeKey] as? Date
})

for date in existing.subtracting(requested) {
    let result = IOPMCancelScheduledPowerEvent(date as CFDate, owner as CFString, wakeType)
    guard result == kIOReturnSuccess else { fail("Could not cancel AthanBot wake: \(result)") }
}
for date in requested.subtracting(existing).sorted() {
    let result = IOPMSchedulePowerEvent(date as CFDate, owner as CFString, wakeType)
    guard result == kIOReturnSuccess else { fail("Could not schedule AthanBot wake: \(result)") }
}
