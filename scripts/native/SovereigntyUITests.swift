import XCTest

final class SovereigntyUITests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "app.svrgn.mobile")
    private let password = "synthetic iOS acceptance phrase"

    private func element(_ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    private func visible(_ item: XCUIElement) {
        XCTAssertTrue(item.waitForExistence(timeout: 20))
        for _ in 0..<8 {
            if item.isHittable { return }
            app.swipeUp()
        }
        XCTFail("Expected a reachable control")
    }

    private func tap(_ id: String) {
        let item = element(id)
        visible(item)
        XCTAssertTrue(item.isEnabled, "Control must be enabled: " + id)
        item.tap()
    }

    private func fill(_ id: String, _ value: String) {
        let item = element(id)
        visible(item)
        item.tap()
        // Exercise burst input: controlled JS feedback previously reordered a
        // title character. Native-owned inputs must preserve the exact text.
        item.typeText(value)
        if item.elementType == .secureTextField {
            XCTAssertEqual((item.value as? String)?.count, value.count)
        } else {
            XCTAssertEqual(item.value as? String, value)
        }
        item.typeText("\n")
    }

    private func evidence(_ name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let tree = XCTAttachment(string: app.debugDescription)
        tree.name = name + "-accessibility"
        tree.lifetime = .keepAlways
        add(tree)
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    override func tearDownWithError() throws {
        // Fixed synthetic sandbox only. Preserve useful failure diagnostics even
        // if GitHub artifact upload is temporarily unavailable.
        print("SVRGN_UI_FINAL_TREE\n" + app.debugDescription)
        evidence("final-state")
    }

    func testEncryptedVaultLifecycle() throws {
        // The harness creates a fresh simulator. Never reset a user's sandbox.
        app.launch()
        XCTAssertTrue(element("master-password").waitForExistence(timeout: 30))
        evidence("setup")
        fill("master-password", "synthetic abandoned entry")
        fill("confirm-master-password", "synthetic abandoned entry")
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertEqual(element("master-password").value as? String, "")
        XCTAssertEqual(element("confirm-master-password").value as? String, "")
        fill("master-password", password)
        fill("confirm-master-password", password)
        tap("action-create-encrypted-vault")
        XCTAssertTrue(element("action-lock-vault").waitForExistence(timeout: 30))
        tap("action-add-login")
        fill("title", "Synthetic iOS login")
        fill("username-or-email", "native-fixture@example.invalid")
        tap("action-reveal-password")
        fill("password", "synthetic typed password")
        tap("action-hide-password")
        tap("action-reveal-password")
        XCTAssertEqual(element("password").value as? String, "synthetic typed password")
        tap("action-generate-password")
        let generatedPassword = try XCTUnwrap(element("password").value as? String)
        XCTAssertEqual(generatedPassword.count, 24)
        tap("action-hide-password")
        tap("action-save-login")
        XCTAssertTrue(element("action-edit-synthetic-ios-login").waitForExistence(timeout: 20))
        fill("search-logins", "SYNTHETIC")
        XCTAssertTrue(element("action-edit-synthetic-ios-login").exists)
        evidence("saved-login")

        app.terminate()
        app.launch()
        XCTAssertTrue(element("action-unlock-vault").waitForExistence(timeout: 20))
        XCTAssertFalse(element("action-edit-synthetic-ios-login").exists)
        fill("master-password", "synthetic wrong password")
        tap("action-unlock-vault")
        XCTAssertTrue(app.staticTexts["Could not create or unlock the vault. Check the password and encrypted storage."].firstMatch.waitForExistence(timeout: 30))
        XCTAssertEqual(element("master-password").value as? String, "")
        XCTAssertFalse(element("action-edit-synthetic-ios-login").exists)
        fill("master-password", password)
        tap("action-unlock-vault")
        XCTAssertTrue(element("action-edit-synthetic-ios-login").waitForExistence(timeout: 30))
        tap("action-edit-synthetic-ios-login")
        XCTAssertEqual(element("username-or-email").value as? String, "native-fixture@example.invalid")
        tap("action-reveal-password")
        XCTAssertEqual(element("password").value as? String, generatedPassword)

        // A real OS transition must clear the editor and revoke the session.
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(element("action-unlock-vault").waitForExistence(timeout: 20))
        XCTAssertFalse(element("username-or-email").exists)
        XCTAssertEqual(element("master-password").value as? String, "")
        evidence("background-locked")
        fill("master-password", password)
        tap("action-unlock-vault")
        XCTAssertTrue(element("action-edit-synthetic-ios-login").waitForExistence(timeout: 30))
        tap("action-edit-synthetic-ios-login")
        fill("website", "https://example.invalid")
        tap("action-save-login")
        XCTAssertTrue(element("action-edit-synthetic-ios-login").waitForExistence(timeout: 20))
        tap("action-delete-synthetic-ios-login")
        XCTAssertTrue(app.alerts["Delete login?"].waitForExistence(timeout: 10))
        app.alerts["Delete login?"].buttons["Cancel"].tap()
        XCTAssertTrue(element("action-edit-synthetic-ios-login").exists)
        tap("action-delete-synthetic-ios-login")
        app.alerts["Delete login?"].buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts["0 logins saved locally"].firstMatch.waitForExistence(timeout: 20))
        evidence("confirmed-deletion")
        tap("action-lock-vault")
        fill("master-password", password)
        tap("action-unlock-vault")
        XCTAssertTrue(app.staticTexts["0 logins saved locally"].firstMatch.waitForExistence(timeout: 30))
        tap("action-lock-vault")
        XCTAssertTrue(element("action-unlock-vault").waitForExistence(timeout: 20))
    }
}
