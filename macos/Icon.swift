import AppKit

let image = NSImage(size: NSSize(width: 1024, height: 1024), flipped: false) { _ in
    let tile = NSBezierPath(roundedRect: NSRect(x: 96, y: 96, width: 832, height: 832), xRadius: 186, yRadius: 186)
    let top = NSColor(srgbRed: 0.13, green: 0.35, blue: 0.25, alpha: 1)
    let bottom = NSColor(srgbRed: 0.06, green: 0.21, blue: 0.17, alpha: 1)
    NSGradient(starting: top, ending: bottom)?.draw(in: tile, angle: -90)
    let ivory = NSColor(srgbRed: 0.95, green: 0.94, blue: 0.84, alpha: 1)
    ivory.setStroke()
    let clock = NSBezierPath(ovalIn: NSRect(x: 280, y: 280, width: 464, height: 464))
    clock.lineWidth = 33
    clock.stroke()
    let hands = NSBezierPath()
    hands.move(to: NSPoint(x: 512, y: 644))
    hands.line(to: NSPoint(x: 512, y: 512))
    hands.line(to: NSPoint(x: 607, y: 456))
    hands.lineWidth = 38
    hands.lineCapStyle = .round
    hands.lineJoinStyle = .round
    hands.stroke()
    return true
}
let iconset = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let dimension = size * scale
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: dimension, pixelsHigh: dimension,
                                      bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                      bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        image.draw(in: NSRect(x: 0, y: 0, width: dimension, height: dimension))
        NSGraphicsContext.restoreGraphicsState()
        let suffix = scale == 1 ? "" : "@2x"
        try bitmap.representation(using: .png, properties: [:])!.write(to: iconset.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
    }
}
