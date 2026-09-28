# Use the VIP Brioi video route

This fork inherits the Hypit Skill's full creative and production workflow. Its service choice
for supported Seedance video requests is the project's `@infinite-replica/provider-vip-brioi`
Endpoint, not the official Skill's example HypiHub account. Source, Runs and the Hypit CLI
retain their ordinary names and formats.

## Establish the selected project route

Work in the actual video project, not merely the Provider repository. Inspect `hypit version`,
`hypit paths` and the selected Runtime Profile. If the Provider or VIP Profile is missing,
use the installation procedure in the `infinite-replica-master` project's README and
`scripts/setup-hypit-vip.mjs`, targeting that video project's workspace. Do not overwrite
an existing project Profile or binding without reading it first. The setup writes a VIP
Profile, but the user or agent must still select it with `hypit runtime use`.

The Profile's `vip-brioi.video` Endpoint must point to this Provider and use a credential
reference. Verify these explicit bindings for the capabilities this Provider offers:

| Hypit capability | VIP model |
| --- | --- |
| `@hypit/seedance@1#seedance-2` | `seedance-2-0` |
| `@hypit/seedance@1#seedance-2-fast` | `seedance-2-0-fast` |
| `@hypit/seedance@1#seedance-2-mini` | `seedance-2-0-mini` |
| `@hypit/seedance@1#seedance-2.5` | `seedance-2-5` |

Other video models are not implemented by this Provider. Seedance 2.5 supports 4-30 second
integer outputs, 480p/720p/1080p, up to 30 images/10 videos/10 audio references (50 total),
and audio-only references; it does not accept Hypit's `-1` automatic duration or 4K. Its
video-reference path has a documented upstream ingestion issue, while audio and strict frame
paths have not completed live acceptance. A VIP
binding does not connect image, speech or alignment services either. A real work may
need those capabilities: continue reference analysis and authoring, then identify the
unsupported Need and discuss an explicit provider/account and spending scope with the
user. Do not silently redirect a VIP video Need to HypiHub or any other paid service.

Use `hypit auth status vip-brioi.video` to check for a stored key without revealing it.
When an account connection is needed, use `hypit auth login vip-brioi.video`; do not
paste the key into chat, the Profile or source files. `hypit plan <run>` checks the
selected Needs and compatibility without creating video tasks. Confirm the actual
account, priced work and budget before any paid Build. Never generate merely to test setup.

## Respect the actual API contract

The Provider calls VIP `POST /v1/videos`, polls the acknowledged task with
`GET /v1/videos/{id}` and collects the returned result through Hypit's Resource Store.
An acknowledged task is not an output; after uncertain submission, recover or inspect
the existing task rather than reissuing a paid request automatically.

The published Profile uses `personReferencePolicy: "advisory"`. VIP's current `ref[]`
request does not declare Hypit's `personReference` boolean: the Provider accepts it only
under that explicit policy and transmits media roles/URLs without that classification.
Do not promise identity lock or exact object/hand preservation. Changing the policy to
`"reject"` makes such requests fail before upload or submission. `generateAudio: true`,
`webSearch: true`, adaptive ratio, or an unsupported model must also fail instead of
silently dropping the authored input.

Private or local reference media may be copied to the public Uguu host so VIP can read
them, within its size limit. Tell the user before transferring sensitive media to that
third-party host; if that is unacceptable, choose a user-approved private transport
before generating. A public HTTPS reference can be used without reuploading. Reference
generation is approximate, not mask-based pixel-perfect editing.

When the user specifies protected visual content, record what may and may not change in
the Brief; clarify a meaningful ambiguity before authoring/generation. Compare output
against the original across the full relevant interval, including action, contacts,
hands, continuity and audio. Do not state that something remained unchanged without
watching the rendered result.
