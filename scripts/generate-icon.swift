import AppKit

// Run: swift scripts/generate-icon.swift assets/icon.png
let destination = CommandLine.arguments.dropFirst().first ?? "assets/icon.png"
let size = 1024
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
  space: colorSpace, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
let gradient = CGGradient(colorsSpace: colorSpace, colors: [
  CGColor(srgbRed: 0.04, green: 0.62, blue: 1, alpha: 1),
  CGColor(srgbRed: 0.05, green: 0.22, blue: 0.86, alpha: 1)
] as CFArray, locations: [0, 1])!
context.drawLinearGradient(gradient, start: CGPoint(x: 100, y: 1024), end: CGPoint(x: 924, y: 0),
  options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
NSColor.white.setFill()
for (x, height) in [(228.0, 152.0), (316.0, 320.0), (404.0, 216.0)] {
  NSBezierPath(roundedRect: NSRect(x: x, y: 512 - height / 2, width: 48, height: height),
               xRadius: 24, yRadius: 24).fill()
}
let play = NSBezierPath()
play.move(to: NSPoint(x: 538, y: 724))
play.curve(to: NSPoint(x: 508, y: 707), controlPoint1: NSPoint(x: 524, y: 732), controlPoint2: NSPoint(x: 508, y: 723))
play.line(to: NSPoint(x: 508, y: 317))
play.curve(to: NSPoint(x: 538, y: 300), controlPoint1: NSPoint(x: 508, y: 301), controlPoint2: NSPoint(x: 524, y: 292))
play.line(to: NSPoint(x: 810, y: 495))
play.curve(to: NSPoint(x: 810, y: 529), controlPoint1: NSPoint(x: 824, y: 503), controlPoint2: NSPoint(x: 824, y: 521))
play.close()
play.fill()
NSGraphicsContext.restoreGraphicsState()
let bitmap = NSBitmapImageRep(cgImage: context.makeImage()!)
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: destination))
