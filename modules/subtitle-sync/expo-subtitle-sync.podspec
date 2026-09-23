require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoSubtitleSync'
  s.version        = package['version']
  s.summary        = package['description']
  s.homepage       = 'https://github.com/filmsnaps/filmsnaps'
  s.license        = 'MIT'
  s.author         = 'filmsnaps'
  s.source         = { git: '' }
  s.platform       = :ios, '15.0'
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.dependency 'onnxruntime-objc', '~> 1.20'

  s.source_files = 'ios/**/*.{swift,h,m}'
end
