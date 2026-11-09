// Renders the app icon (white rounded square, indigo sparkles) to a 1024px PNG.
// Usage: swift scripts/make-icon.swift build/icon.png  (then npm run build:icon makes build/icon.icns)
import AppKit

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "build/icon.png"
let size = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

// macOS icon grid: 824px rounded square centred on the 1024 canvas, with a soft drop shadow.
let tile = NSRect(x: 100, y: 100, width: 824, height: 824)
let path = NSBezierPath(roundedRect: tile, xRadius: 185, yRadius: 185)
NSGraphicsContext.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowColor = NSColor.black.withAlphaComponent(0.22)
shadow.shadowOffset = NSSize(width: 0, height: -12)
shadow.shadowBlurRadius = 28
shadow.set()
NSColor.white.setFill()
path.fill()
NSGraphicsContext.restoreGraphicsState()
NSColor(white: 0.88, alpha: 1).setStroke()
path.lineWidth = 3
path.stroke()

// Sparkles, the app's mark (#6366f1).
let indigo = NSColor(srgbRed: 0x63 / 255, green: 0x66 / 255, blue: 0xf1 / 255, alpha: 1)
let config = NSImage.SymbolConfiguration(pointSize: 470, weight: .medium).applying(NSImage.SymbolConfiguration(paletteColors: [indigo]))
let symbol = NSImage(systemSymbolName: "sparkles", accessibilityDescription: nil)!.withSymbolConfiguration(config)!
let s = symbol.size
symbol.draw(in: NSRect(x: (CGFloat(size) - s.width) / 2, y: (CGFloat(size) - s.height) / 2, width: s.width, height: s.height))

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
