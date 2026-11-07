# RePID Enterprise — maintainer guide

RePID is free for individuals. Companies use **RePID Enterprise**: $20 USD per computer per year, paid with the PayPal subscription button.

Everything works **without a server or database**:

| Piece | How it works |
|---|---|
| License | A key signed with Ed25519. The private key never leaves the maintainer's computer (`~/.repid-license/private-key.pem`); the app embeds only the public key (`LICENSE_PUBLIC_KEY` in `src/shared/constants.ts`). Changing a single character (company, seats, expiry) breaks the signature. |
| Expiry | The expiry date is inside the signed key. On that day a banner asks to renew; 14 days later the Enterprise sections lock until a new key is activated. RePID never accepts a date earlier than the latest it has seen, and Enterprise reads GitHub's server time every 6 hours, so setting the computer's clock back does not extend a license. |
| Seats | Enterprise copies announce their license id on the local network; more copies than seats on one network → the extra ones are limited. |
| Free-edition limit | Free copies announce themselves on the local network (UDP broadcast, port 47913, same subnet only). More than 5 free copies seen in 14 days → Automatic, Services, Updates, Disk and Network are locked and a banner asks for RePID Enterprise. |
| Company computers | Domain / Azure AD join, Windows Server or MDM enrollment, read locally → a notice only (everything keeps working). |
| Support | The app shows a support code `RPE-<LICENSE ID>-<8 signature chars>` and opens an email with a fixed subject and the full key in the body. |

## Authorship & provenance (RellyDev — Voxel Enterprise)

RePID is open source, so there is no secret, undeletable mark — anyone can read every line. What *does* prove origin, and cannot be forged:

- **Signed releases and licenses.** Only the maintainer's Ed25519 private key (kept offline) can sign an installer or a license key that RePID verifies as genuine. A copy without that signature is provably not official.
- **Recorded authorship.** `LICENSE`, `NOTICE`, the README and the app all state *RellyDev — Voxel Enterprise*. The license's Notices section requires these to be preserved; removing them is a license violation that gives you legal standing.
- **Public history.** GitHub's commit history timestamps you as the original author.

## Selling a license

1. The customer subscribes with PayPal (one subscription per computer, or agree a quantity by email).
2. Issue the key (use the PayPal payer's company name and email):

   ```bash
   npm run license -- --company "Acme S.A." --email it@acme.com --seats 10 --months 12
   ```

3. Email the printed `REPID1-…` key. The customer installs **RePID-Identity-Enterprise-x.y.z** and pastes the key in **About → License**.
4. On renewal, issue a new key (the old one keeps working 14 days after expiry).

## Answering support

Support emails arrive at **soporte@voxel.lat** (Spanish) / **support@voxel.lat** (English) with this subject:

```
[RePID Enterprise][Soporte] RPE-CDAA08643F80-t0tj8Bzw · Acme S.A. · v1.5.0
[RePID Enterprise][Support] …        [RePID Enterprise][Beta] …
```

Paste the key from the email body to check it:

```bash
npm run license -- --verify "REPID1-…"
```

It prints ✓ Genuine (company, computers, expiry) and the support code, which must match the subject. A forged or edited key prints ✗. Verification only needs the public key, so anyone on the support team can run it.

**Beta access:** reply to `[Beta]` requests from genuine licenses with the download link of the beta build.

## Building the installers

```bash
npm run dist:win               # free:       RePID-Identity-1.5.0-win-x64.exe
npm run dist:win:enterprise    # enterprise: RePID-Identity-Enterprise-1.5.0-win-x64.exe
```

Upload both to the [download page](https://github.com/rellytechgame/repid-identity/releases/tag/win-release). Each edition only follows its own installer for update notices. Both install as the same app, so installing Enterprise over the free edition keeps every setting.

## Back up the private key

Losing `~/.repid-license/private-key.pem` means no new licenses can be issued for builds that embed its public key. Keep an offline copy. Never commit it, paste it anywhere or send it to anyone.

## Limits, honestly

- The source code is public: someone able to rebuild RePID could remove the checks from their own copy. The license protects the official builds and makes forging keys impossible; it is a deterrent, not DRM.
- Network counting only sees copies on the same subnet. Separate VLANs, guest Wi-Fi with client isolation or a firewall blocking UDP 47913 hide copies from each other.
- This and later versions are dual-licensed: free for noncommercial use (PolyForm Noncommercial 1.0.0) and a paid commercial license for companies, so commercial payment is a license requirement, not just a request. Versions previously published under MIT stay MIT for those versions.
- The authorship of RellyDev — Voxel Enterprise is recorded in LICENSE, NOTICE, the app and the signed releases. Someone can still edit their own copy, but removing the Required Notice or the commercial-license terms is itself a license violation, and only Voxel Enterprise's private key can sign an installer or a license that verifies as genuine — that signature is the real, unforgeable proof of origin.
