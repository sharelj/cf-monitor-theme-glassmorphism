/**
 * OS 图标：使用 CF-Server-Monitor 默认皮肤自带的 /os-icons/<file>，不打包进主题。
 * 图标名与默认皮肤保持一致；没有对应图标的系统回退到 os-unknown.svg。
 */
import { publicAssetUrl } from '@/cfsm/apiBase'

interface OSConfig {
  name: string
  image: string
  keywords: string[]
}

const OS_NAME_SPLIT_REGEX = /[\s/]+/

const osConfigs: OSConfig[] = [
  { name: 'AlmaLinux', image: 'os-alma.svg', keywords: ['alma'] },
  { name: 'Alpine Linux', image: 'os-alpine.webp', keywords: ['alpine'] },
  { name: 'Armbian', image: 'os-armbian.png', keywords: ['armbian'] },
  { name: 'CentOS', image: 'os-centos.svg', keywords: ['centos', 'cent os'] },
  { name: 'Debian', image: 'os-debian.svg', keywords: ['debian', 'deb'] },
  { name: 'Ubuntu', image: 'os-ubuntu.svg', keywords: ['ubuntu', 'elementary'] },
  { name: 'macOS', image: 'os-macos.svg', keywords: ['macos', 'mac os', 'darwin', 'os x'] },
  { name: 'Windows', image: 'os-windows.svg', keywords: ['windows', 'win32', 'win64', 'microsoft', 'ms'] },
  { name: 'Arch Linux', image: 'os-arch.svg', keywords: ['arch', 'archlinux', 'arch linux'] },
  { name: 'Kali Linux', image: 'os-kail.svg', keywords: ['kail', 'kali'] },
  { name: 'iStoreOS', image: 'os-istore.png', keywords: ['istore'] },
  { name: 'OpenWrt', image: 'os-openwrt.svg', keywords: ['openwrt', 'open wrt', 'open-wrt', 'qwrt', 'kwrt'] },
  { name: 'ImmortalWrt', image: 'os-openwrt.svg', keywords: ['immortalwrt', 'immortal'] },
  { name: 'NixOS', image: 'os-nix.svg', keywords: ['nixos', 'nix os', 'nix'] },
  { name: 'Rocky Linux', image: 'os-rocky.svg', keywords: ['rocky', 'rockylinux'] },
  { name: 'Fedora', image: 'os-fedora.svg', keywords: ['fedora'] },
  { name: 'openSUSE', image: 'os-openSUSE.svg', keywords: ['opensuse', 'suse'] },
  { name: 'Gentoo', image: 'os-gentoo.svg', keywords: ['gentoo'] },
  { name: 'Red Hat', image: 'os-redhat.svg', keywords: ['redhat', 'red hat', 'rhel'] },
  { name: 'Linux Mint', image: 'os-mint.svg', keywords: ['mint'] },
  { name: 'Manjaro', image: 'os-manjaro-.svg', keywords: ['manjaro'] },
  { name: 'Oracle Linux', image: 'os-oracle.svg', keywords: ['oracle'] },
  { name: 'OpenCloudOS', image: 'os-opencloud.svg', keywords: ['opencloud'] },
  { name: 'Alibaba Cloud Linux', image: 'os-alibaba.svg', keywords: ['aliyun', 'alibaba'] },
  { name: 'Proxmox', image: 'os-proxmox.ico', keywords: ['proxmox', 'pve'] },
  { name: 'Synology DSM', image: 'os-synology.ico', keywords: ['synology', 'dsm'] },
  { name: 'FreeBSD', image: 'os-unknown.svg', keywords: ['freebsd', 'bsd'] },
  { name: 'Unraid', image: 'os-unknown.svg', keywords: ['unraid'] },
]

const defaultOSConfig: OSConfig = { name: 'Unknown', image: 'os-unknown.svg', keywords: [] }

function findOSConfig(osString: string): OSConfig {
  const normalizedInput = String(osString ?? '').toLowerCase().trim()
  if (!normalizedInput)
    return defaultOSConfig
  for (const config of osConfigs) {
    if (config.keywords.some(keyword => normalizedInput.includes(keyword)))
      return config
  }
  if (normalizedInput.includes('linux'))
    return { name: 'Linux', image: 'os-unknown.svg', keywords: [] }
  return defaultOSConfig
}

/** 图标地址（相对路径，hub 反代主题时即为 /os-icons/...）。 */
export function getOSImage(osString: string): string {
  return publicAssetUrl(`os-icons/${findOSConfig(osString).image}`)
}

export function getOSName(osString: string): string {
  const config = findOSConfig(osString)
  if (config !== defaultOSConfig)
    return config.name
  const parts = String(osString ?? '').trim().split(OS_NAME_SPLIT_REGEX)
  return parts[0] || 'Unknown'
}

export function isSupportedOS(osString: string): boolean {
  return findOSConfig(osString) !== defaultOSConfig
}
