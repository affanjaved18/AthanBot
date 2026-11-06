import AVFoundation
import CoreAudio
import Foundation
import IOBluetooth

struct Output: Encodable {
    let id: String
    let label: String
}

func deviceProperty<T>(_ device: AudioObjectID, _ selector: AudioObjectPropertySelector, into value: inout T) -> Bool {
    var address = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size = UInt32(MemoryLayout<T>.size)
    return withUnsafeMutablePointer(to: &value) {
        AudioObjectGetPropertyData(device, &address, 0, nil, &size, $0) == noErr
    }
}

func outputDevices() -> [(device: AudioObjectID, output: Output)] {
    let system = AudioObjectID(kAudioObjectSystemObject)
    var list = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(system, &list, 0, nil, &size) == noErr else { return [] }
    var devices = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    let result = devices.withUnsafeMutableBytes { buffer in
        guard let pointer = buffer.baseAddress else { return OSStatus(-1) }
        return AudioObjectGetPropertyData(system, &list, 0, nil, &size, pointer)
    }
    guard result == noErr else { return [] }
    return devices.compactMap { device in
        var streams = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioDevicePropertyScopeOutput, mElement: kAudioObjectPropertyElementMain)
        var streamSize: UInt32 = 0
        var alive: UInt32 = 0
        guard AudioObjectGetPropertyDataSize(device, &streams, 0, nil, &streamSize) == noErr,
              streamSize > 0, deviceProperty(device, kAudioDevicePropertyDeviceIsAlive, into: &alive),
              alive != 0 else { return nil }
        var name: CFString?
        var uid: CFString?
        guard deviceProperty(device, kAudioObjectPropertyName, into: &name),
              deviceProperty(device, kAudioDevicePropertyDeviceUID, into: &uid),
              let name, let uid else { return nil }
        return (device, Output(id: "coreaudio/" + (uid as String), label: name as String))
    }
}

func audioOutputs() -> [Output] {
    outputDevices().map(\.output).sorted { $0.label.localizedStandardCompare($1.label) == .orderedAscending }
}

func restoreBuiltInOutput(from output: String) -> Bool {
    let system = AudioObjectID(kAudioObjectSystemObject)
    let selected = output.replacingOccurrences(of: "avfoundation/", with: "coreaudio/", options: .anchored)
    let devices = outputDevices()
    var current = AudioObjectID(0)
    guard deviceProperty(system, kAudioHardwarePropertyDefaultOutputDevice, into: &current),
          devices.contains(where: { $0.device == current && $0.output.id == selected }) else { return true }
    guard var builtIn = devices.first(where: {
        var transport: UInt32 = 0
        return deviceProperty($0.device, kAudioDevicePropertyTransportType, into: &transport) &&
            transport == kAudioDeviceTransportTypeBuiltIn
    })?.device else { return true }
    var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultOutputDevice,
                                             mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    return AudioObjectSetPropertyData(system, &address, 0, nil, UInt32(MemoryLayout<AudioObjectID>.size), &builtIn) == noErr
}

struct PairedSpeaker: Encodable {
    let address: String
    let name: String
}

func pairedSpeakers() -> [PairedSpeaker] {
    (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice] ?? []).compactMap { device in
        guard let address = device.addressString else { return nil }
        return PairedSpeaker(address: address.replacingOccurrences(of: "-", with: ":").uppercased(), name: device.name ?? address)
    }
}

enum AudioFailure: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case let .message(text) = self { return text }
        return nil
    }
}

func playAudio(_ path: String, output: String, preview: Bool) throws {
    let uid: String?
    if output == "auto" {
        uid = nil
    } else {
        let normalized = output.replacingOccurrences(of: "avfoundation/", with: "coreaudio/", options: .anchored)
        guard audioOutputs().contains(where: { $0.id == normalized }) else {
            throw AudioFailure.message("The selected speaker is unavailable.")
        }
        uid = String(normalized.dropFirst("coreaudio/".count))
    }

    let item = AVPlayerItem(url: URL(fileURLWithPath: path))
    let player = AVPlayer(playerItem: item)
    player.volume = 0.5
    player.audioOutputDeviceUniqueID = uid
    if preview { item.forwardPlaybackEndTime = CMTime(seconds: 8, preferredTimescale: 600) }
    var finished = false
    var failure: Error?
    let center = NotificationCenter.default
    let ended = center.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { _ in
        finished = true
    }
    let failed = center.addObserver(forName: .AVPlayerItemFailedToPlayToEndTime, object: item, queue: .main) { note in
        failure = note.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error ?? AudioFailure.message("The recording stopped unexpectedly.")
    }
    defer {
        player.pause()
        center.removeObserver(ended)
        center.removeObserver(failed)
    }
    player.play()
    let startsBy = Date().addingTimeInterval(12)
    while !finished {
        if let failure { throw failure }
        if item.status == .failed { throw item.error ?? AudioFailure.message("The recording could not play.") }
        if player.currentTime().seconds <= 0 && Date() >= startsBy {
            throw AudioFailure.message("Playback did not start. Check the recording and speaker.")
        }
        RunLoop.main.run(until: Date().addingTimeInterval(0.1))
    }
}

do {
    let args = Array(CommandLine.arguments.dropFirst())
    switch args.first {
    case "outputs" where args.count == 1:
        FileHandle.standardOutput.write(try JSONEncoder().encode(audioOutputs()))
    case "paired" where args.count == 1:
        FileHandle.standardOutput.write(try JSONEncoder().encode(pairedSpeakers()))
    case "connect" where args.count == 2, "disconnect" where args.count == 3:
        let address = args[1].replacingOccurrences(of: ":", with: "-")
        guard let device = (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice])?.first(where: {
            $0.addressString?.caseInsensitiveCompare(address) == .orderedSame
        }) else { throw AudioFailure.message("Pair the speaker in Bluetooth settings first.") }
        if args[0] == "disconnect" {
            let restored = restoreBuiltInOutput(from: args[2])
            if device.isConnected() && device.closeConnection() != kIOReturnSuccess {
                throw AudioFailure.message("Could not disconnect the Bluetooth speaker.")
            }
            let deadline = Date().addingTimeInterval(3)
            while device.isConnected() && Date() < deadline {
                RunLoop.current.run(until: Date().addingTimeInterval(0.15))
            }
            if device.isConnected() { throw AudioFailure.message("The Bluetooth speaker is still connected.") }
            if !restored { throw AudioFailure.message("Could not switch the Mac back to its built-in speakers.") }
        } else if !device.isConnected() && device.openConnection() != kIOReturnSuccess {
            throw AudioFailure.message("Could not reconnect the Bluetooth speaker.")
        }
    case "validate" where args.count == 2:
        let file = try AVAudioFile(forReading: URL(fileURLWithPath: args[1]))
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4096) else {
            throw AudioFailure.message("Could not read the audio format.")
        }
        try file.read(into: buffer)
        if buffer.frameLength == 0 { throw AudioFailure.message("The recording has no audio.") }
    case "play" where args.count == 3 || (args.count == 4 && args[3] == "preview"):
        try playAudio(args[1], output: args[2], preview: args.count == 4)
    default:
        throw AudioFailure.message("Invalid audio command.")
    }
} catch {
    FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
    exit(1)
}
