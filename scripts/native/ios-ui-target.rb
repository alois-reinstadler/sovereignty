# Generated Xcode projects stay untracked. This adds a test-only target; the
# normal app has no test URL, runtime switch or privileged test command.
require 'xcodeproj'

path = File.expand_path('../../apps/mobile/ios/Sovereignty.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
app = project.targets.find { |target| target.name == 'Sovereignty' }
abort 'Expected generated Sovereignty application target' unless app
abort 'UI target already exists' if project.targets.any? { |target| target.name == 'SovereigntyUITests' }
target = project.new_target(:ui_test_bundle, 'SovereigntyUITests', :ios, '16.4', nil, :swift)
target.add_dependency(app)
target.build_configurations.each do |configuration|
  configuration.build_settings.merge!({
    'PRODUCT_NAME' => 'SovereigntyUITests',
    'PRODUCT_MODULE_NAME' => 'SovereigntyUITests',
    'PRODUCT_BUNDLE_IDENTIFIER' => 'app.svrgn.mobile.uitests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '1',
    'TEST_TARGET_NAME' => 'Sovereignty',
    'CODE_SIGNING_ALLOWED' => 'NO',
    'CODE_SIGNING_REQUIRED' => 'NO'
  })
end
project.root_object.attributes['TargetAttributes'] ||= {}
project.root_object.attributes['TargetAttributes'][target.uuid] = { 'TestTargetID' => app.uuid }
source = project.main_group.new_file(File.expand_path('SovereigntyUITests.swift', __dir__))
target.source_build_phase.add_file_reference(source)
project.save
scheme = Xcodeproj::XCScheme.new
scheme.configure_with_targets(app, target, launch_target: true)
scheme.test_action.build_configuration = 'Release'
scheme.save_as(path, 'SovereigntyUITests')
