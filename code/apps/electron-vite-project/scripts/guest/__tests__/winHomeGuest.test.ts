import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  resolveHypervisorFromPaths,
  shouldCreateVm,
  shouldReconvergePortForwards,
  UBUNTU_CLOUD_IMAGE_MANIFEST,
  WRDESK_COORDINATION_PORT,
  WRDESK_GUEST_PORTS,
  WRDESK_P2P_INGEST_PORT,
} from '../guestPorts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUEST_DIR = path.resolve(__dirname, '../../../build/guest');

function readGuestFile(name: string): string {
  return fs.readFileSync(path.join(GUEST_DIR, name), 'utf8');
}

describe('Windows Home guest provisioning', () => {
  it('ports match wrdesk-guest-ports.json and tree defaults', () => {
    const ports = JSON.parse(readGuestFile('wrdesk-guest-ports.json'));
    expect(ports.coordination.port).toBe(51249);
    expect(ports.p2pIngest.port).toBe(51250);
    expect(WRDESK_COORDINATION_PORT).toBe(ports.coordination.port);
    expect(WRDESK_P2P_INGEST_PORT).toBe(ports.p2pIngest.port);
    expect(WRDESK_GUEST_PORTS.coordination).toBe(51249);
    expect(WRDESK_GUEST_PORTS.p2pIngest).toBe(51250);
  });

  it('detects VirtualBox before VMware', () => {
    expect(
      resolveHypervisorFromPaths({
        vboxManage: 'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe',
        vmrun: 'C:\\Program Files\\VMware\\vmrun.exe',
      }),
    ).toBe('virtualbox');
  });

  it('detects VMware when VirtualBox absent', () => {
    expect(
      resolveHypervisorFromPaths({
        vboxManage: null,
        vmrun: 'C:\\Program Files\\VMware\\vmrun.exe',
      }),
    ).toBe('vmware');
  });

  it('reports none when no hypervisor paths', () => {
    expect(resolveHypervisorFromPaths({})).toBe('none');
  });

  it('manifest uses official Ubuntu cloud-images URL only', () => {
    const manifest = JSON.parse(readGuestFile('ubuntu-cloud-image.manifest.json'));
    expect(manifest.url).toMatch(/^https:\/\/cloud-images\.ubuntu\.com\//);
    expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/i);
    expect(manifest.filename).toBe(UBUNTU_CLOUD_IMAGE_MANIFEST.filename);
  });

  it('guest artifact directory contains manifest only — no bundled .img', () => {
    const files = fs.readdirSync(GUEST_DIR);
    const imgFiles = files.filter((f) => f.endsWith('.img') || f.endsWith('.iso'));
    expect(imgFiles).toEqual([]);
    expect(files).toContain('ubuntu-cloud-image.manifest.json');
  });

  it('scripts never seed mode sandbox for Windows host or guest', () => {
    const patterns = [
      'detect-hypervisor.ps1',
      'provision-win-home-guest.ps1',
      'provision-virtualbox-guest.ps1',
      'provision-vmware-guest.ps1',
      'launch-win-home-guest.ps1',
      'fetch-ubuntu-cloud-image.ps1',
      'in-guest-install-stack.sh',
    ];
    for (const file of patterns) {
      const content = readGuestFile(file);
      expect(content).not.toMatch(/mode:\s*['"]sandbox['"]/);
      expect(content).not.toMatch(/"mode"\s*:\s*"sandbox"/);
    }
    const appliance = readGuestFile('in-guest-install-stack.sh');
    expect(appliance).toContain('isolation-depackaging');
    expect(appliance).not.toContain('mode: sandbox');
  });

  it('provision state uses isolation appliance and host-only-on-windows', () => {
    const vbox = readGuestFile('provision-virtualbox-guest.ps1');
    expect(vbox).toContain('isolation-depackaging');
    expect(vbox).toContain('host-only-on-windows');
    const launch = readGuestFile('launch-win-home-guest.ps1');
    expect(launch).toContain("role = 'host'");
    expect(launch).toContain('guestAppliance');
    expect(launch).not.toMatch(/Start-Process.*orchestrator/i);
  });

  it('idempotent provision: create once, reconverge on second run', () => {
    expect(shouldCreateVm(true)).toBe(false);
    expect(shouldCreateVm(false)).toBe(true);
    expect(shouldReconvergePortForwards(true)).toBe(true);
    const vbox = readGuestFile('provision-virtualbox-guest.ps1');
    expect(vbox).toMatch(/already exists/i);
    expect(vbox).toMatch(/re-converging/i);
  });

  it('fetch script verifies checksum and refuses non-official URLs', () => {
    const fetch = readGuestFile('fetch-ubuntu-cloud-image.ps1');
    expect(fetch).toMatch(/cloud-images\.ubuntu\.com/);
    expect(fetch).toMatch(/SHA256|sha256/);
    expect(fetch).toMatch(/Refusing non-official/);
  });

  it('detect-hypervisor never installs hypervisors', () => {
    const detect = readGuestFile('detect-hypervisor.ps1');
    expect(detect).toMatch(/Never installs/i);
    expect(detect).not.toMatch(/Invoke-WebRequest.*virtualbox/i);
    expect(detect).not.toMatch(/choco install|winget install/i);
  });

  it('WIN-HOME-SETUP documents manual hypervisor install', () => {
    const doc = readGuestFile('WIN-HOME-SETUP.md');
    expect(doc).toMatch(/virtualbox\.org/i);
    expect(doc).toMatch(/vmware\.com/i);
    expect(doc).toMatch(/51249/);
    expect(doc).toMatch(/51250/);
    expect(doc).toMatch(/does not.*bundle/i);
  });

  it('launch handoff targets guest coordination port', () => {
    const launch = readGuestFile('launch-win-home-guest.ps1');
    expect(launch).toContain('win-home-guest-handoff.json');
    expect(launch).toContain('orchestratorUiUrl');
    expect(launch).toContain('127.0.0.1');
  });
});

describe('installer artifact guard', () => {
  it('build/guest has no large image blobs committed', () => {
    const files = fs.readdirSync(GUEST_DIR);
    for (const f of files) {
      const full = path.join(GUEST_DIR, f);
      const st = fs.statSync(full);
      if (st.isFile() && (f.endsWith('.img') || f.endsWith('.vmdk') || f.endsWith('.ova'))) {
        throw new Error(`Unexpected image artifact in repo: ${f}`);
      }
    }
    expect(true).toBe(true);
  });
});
