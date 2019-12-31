# How to enable passwordless login

> Original tuto [here](https://askubuntu.com/questions/1167691/passwordless-login-with-yubikey-5-nfc) 

1. `$ sudo apt install libpam-u2f`

2. `$ pamu2fcfg | sudo tee /etc/u2f_mappings` for your current user
   `$ sudo pamu2fcfg | sudo tee -a /etc/u2f_mappings` for the root user

   \# (At this point, press the button. You should see a long string of numbers. If you don't, make sure you have `udev` setup correctly.) 

4. `$ sudo -i`

4. `$ cd /etc/pam.d`

5. `$ echo 'auth sufficient pam_u2f.so authfile=/etc/u2f_mappings cue' > common-u2f`

6. ```bash
   for f in gdm-password sudo login; do
   mv $f $f~
   awk '/@include common-auth/ {print "@include common-u2f"}; {print}' $f~ > $f
   done
   ```

7. exit