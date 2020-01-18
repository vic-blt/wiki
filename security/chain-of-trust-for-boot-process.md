# Goal

The purpose of this tutorial is to create a chain of trust which will prevent the alteration of the boot process.
**Chain of trust :** Self-signed EFI keys > self-signed preloader > self-signed bootloader config, kernel and initrd > self-signed kernel modules + encrypted filesystem.

# Table

0. [Limitations](#0-limitations)
1. [Secure boot](#1-secure-boot)
2. [Preloader](#2-preloader)
3. [Signing](#3-signing)
4. [Filesystem](#4-filesystem)

# 0. Limitations

Enabling the secure boot will result in these limitations :
 - Loading kernel modules that are not signed by a trusted key. By default, this will block out-of-tree modules including DKMS-managed drivers. However, you can create your own signing key for modules and add its certificate to the trusted list using [MOK](https://wiki.debian.org/SecureBoot#MOK_-_Machine_Owner_Key) or by signing the kernel module with the **db.key** installed in your EFI.
 - Using kexec to start an unsigned kernel image. 
 - Hibernation and resume from hibernation. 
 - User-space access to physical memory and I/O ports. 
 - Module parameters that allow setting memory and I/O port addresses. 
 - Writing to MSRs through `/dev/cpu/*/msr`. 
 - Use of custom ACPI methods and tables. 
 - ACPI APEI error injection. 

# 1. Secure boot

### Requirements

Install `efitools`, `openssl`, and either `sbsigntool` or `pesign`.

### Generate keys

```bash
openssl req -new -x509 -newkey rsa:2048 -subj "/CN=PK/" -keyout PK.key  -out PK.crt -days 7300 -nodes -sha256
openssl req -new -x509 -newkey rsa:2048 -subj "/CN=KEK/" -keyout KEK.key -out KEK.crt -days 7300 -nodes -sha256
openssl req -new -x509 -newkey rsa:2048 -subj "/CN=db/" -keyout db.key  -out db.crt -days 7300 -nodes -sha256
```

### Prepare EFI keys

```bash
cert-to-efi-sig-list PK.crt PK.esl
sign-efi-sig-list -k PK.key -c PK.crt PK PK.esl PK.auth
cert-to-efi-sig-list KEK.crt KEK.esl
sign-efi-sig-list -k PK.key -c PK.crt KEK KEK.esl KEK.auth
cert-to-efi-sig-list db.crt db.esl
sign-efi-sig-list -k KEK.key -c KEK.crt db db.esl db.auth
```

### Backup current EFI keys

```bash
efi-readvar -v PK -o PK.esl
efi-readvar -v KEK -o KEK.esl
efi-readvar -v db -o db.esl
efi-readvar -v dbx -o dbx.esl
```

### Clear current EFI keys

Enable `Setup Mode` in your UEFI firmware and delete all existing keys. 

### Check there's no EFI keys anymore

```bash
efi-readvar
```

### Install new and self-signed EFI keys

**NB:** Add PK last as it will enable `Custom Mode`.\
The EFI variables may be immutable (`i`-flag in `lsattr` output) in recent kernels, make them mutable again : `chattr -i /sys/firmware/efi/efivars/{PK,KEK,db,dbx}-*`

```bash
efi-updatevar -f db.auth db
efi-updatevar -f KEK.auth KEK
efi-updatevar -f PK.auth PK
```

### Check that your EFI keys have been installed

```bash
efi-readvar
```

# 2. Preloader

### Generate a secure password

```bash
grub-mkpasswd-pbkdf2 --iteration-count=65536
```

### Create grub-initial.cfg 

- Get `$PWD` from previous command
- `$PART` is the partition number, e.g. : `hd0,gpt2`. You can use `search.fs_uuid` to find it.
- `$GRUB_PATH` e.g. : `/boot/grub`

```bash
set superusers="root"
set check_signatures=enforce
export check_signatures
password_pbkdf2 root grub.pbkdf2.sha512.65536.$PWD
configfile ($PART)$GRUB_PATH/grub.cfg
echo Did not boot the system but returned to the initial cfg.
echo Rebooting the system in 5 seconds.
sleep 5
reboot
```

### Create gen_preloader.sh

```bash
#!/bin/sh

set -eu

GPG_KEY='YOUR GPG KEY'

# GRUB doesn't allow loading new modules from disk when secure boot is in
# effect, therefore pre-load the required modules.
MODULES=
MODULES="$MODULES part_gpt fat ext2 zfs"          # partition and file systems for EFI
MODULES="$MODULES configfile"                     # source command
MODULES="$MODULES verifiers gcry_sha512 gcry_rsa" # signature verification
MODULES="$MODULES password_pbkdf2"                # hashed password
MODULES="$MODULES echo normal linux linuxefi"     # boot linux
MODULES="$MODULES all_video"                      # video output
MODULES="$MODULES search search_fs_uuid"          # search --fs-uuid
MODULES="$MODULES reboot sleep"                   # sleep, reboot

rm -rf tmp
mkdir -p tmp

TMP_GPG_KEY='tmp/gpg.key'
TMP_GRUB_CFG='tmp/grub-initial.cfg'
TMP_GRUB_SIG="$TMP_GRUB_CFG.sig"
TMP_GRUB_EFI='tmp/grubx64.efi'

gpg --export "$GPG_KEY" >"$TMP_GPG_KEY"

cp grub-initial.cfg "$TMP_GRUB_CFG"
rm -f "$TMP_GRUB_SIG"
gpg --default-key "$GPG_KEY" --detach-sign "$TMP_GRUB_CFG"

grub-mkstandalone \
    --directory /usr/lib/grub/x86_64-efi \
    --format x86_64-efi \
    --modules "$MODULES" \
    --pubkey "$TMP_GPG_KEY" \
    --output "$TMP_GRUB_EFI" \
    "boot/grub/grub.cfg=$TMP_GRUB_CFG" \
    "boot/grub/grub.cfg.sig=$TMP_GRUB_SIG"
```
Then **RUN** the script.

### Sign preloader

- Using sbsign

  ```bash
  sbsign --key db.key --cert db.crt --output grubx64-signed.efi tmp/grubx64.efi
  ```

- Using pesign
  
  - ```bash
    mkdir certdb
    ```

  - Create a new certificate database
    ```bash
    certutil -N -d certdb
    ```
    
  - ```bash
    modutil -add pkcs11 -libfile /usr/lib/x86_64-linux-gnu/opensc-pkcs11.so -dbdir certdb
    ```

  - ```bash
    modutil -enable pkcs11 -dbdir certdb
    ```
    
  - Either
    - Add a certificate to the database
    ```bash
    certutil -A -i db.crt -d certdb -n "efi-cert" -t ,,,
    ```
    Then sign
    ```bash
    pesign -s -c "$CERT_NAME" -n certdb -i tmp/grubx64.efi -o grubx64-signed.efi
    ```
    
    - Or import `db.key` and `db.pem` into a smartcard (e.g. : YubiKey) PIV applet
    ```bash
    yubico-piv-tool -s 9c -a import-key -i db.key
    yubico-piv-tool -s 9c -a import-certificate -i db.crt
    ```
    Then 
    ```bash
    modutil -dbdir certdb -list pkcs11       // Get $TOKEN_NAME value
    certutil -d certdb -h "$TOKEN_NAME" -L   // Get $CERT_NAME value from the line with $TOKEN_NAME:$CERT_NAME 
    ```
    And sign
    ```bash
    pesign -s -c "$CERT_NAME" -t "$TOKEN_NAME" -n certdb -i tmp/grubx64.efi -o grubx64-signed.efi
    ```

### Move preloader

```bash
sudo mv grubx64-signed.efi /boot/efi/EFI/debian/
```

### Add an EFI boot entry

```bash
sudo efibootmgr --disk /dev/nvme0n1 --part 1 --create --label "Debian Signed" --loader '\EFI\debian\grubx64-signed.efi' --verbose
```

# 3. Signing

- grub.cfg, vmlinuz and initrd :

    ```bash
    sudo -i
    gpg --quiet --no-permission-warning --homedir $GPG_HOMEDIR --detach-sign --default-key $GPG_KEY < /boot/grub/grub.cfg > /boot/grub/grub.cfg.sig
    gpg --quiet --no-permission-warning --homedir $GPG_HOMEDIR --detach-sign --default-key $GPG_KEY < /boot/vmlinuz > /boot/vmlinuz.sig
    gpg --quiet --no-permission-warning --homedir $GPG_HOMEDIR --detach-sign --default-key $GPG_KEY < /boot/initrd > /boot/initrd.sig
    ```
    You can automate the signing by creating a script and put it in `/etc/kernel/postinst.d/` and `/etc/kernel/postrm.d/`.

- Kernel modules :

    ```bash
    /usr/lib/$(uname -r)/scripts/sign-file sha256 db.key db.der <module>
    ```

# 4. Filesystem

See [ZFS with native encryption](https://github.com/zfsonlinux/zfs/wiki/Debian-Buster-Root-on-ZFS) or LUKSv2 encryption with other file system like BTRFS.

# Sources
 - https://ruderich.org/simon/notes/secure-boot-with-grub-and-signed-linux-and-initrd
 - https://wiki.debian.org/SecureBoot#Secure_Boot_limitations
 - https://raymii.org/s/articles/Nitrokey_HSM_in_Apache_with_mod_nss.html

