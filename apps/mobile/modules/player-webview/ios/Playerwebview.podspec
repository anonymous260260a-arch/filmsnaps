Pod::Spec.new do |s|
  s.name           = 'Playerwebview'
  s.version        = '0.1.0'
  s.summary        = 'Custom native WebView for video player reliability'
  s.description    = 'Native WebView module with ad blocking, reliable navigation, and fullscreen support'
  s.license        = 'MIT'
  s.author         = 'FilmSnaps'
  s.homepage       = 'https://filmsnaps.app'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.4'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  if defined?(install_modules_dependencies)
    install_modules_dependencies(s)
  end

  s.source_files = '**/*.{h,m,swift}'
end
